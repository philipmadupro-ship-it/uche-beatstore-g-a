import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getById, update, requireRowOwnership } from '@/lib/db';
import { readStoredObject } from '@/lib/storage/upload';
import { buildAndUploadSidecars } from '@/lib/audio/sidecars';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.peaks');

export const runtime = 'nodejs';
export const maxDuration = 60;

interface TrackPeaksRow {
  audio_url: string | null;
  peaks_url?: string | null;
}

/**
 * Backfill the precomputed peaks sidecar for a single track.
 *
 * Why: tracks created before peaks_url existed (and any whose peak extraction
 * silently failed at upload time) currently force the WavePlayer to decode
 * the full audio in the browser. This endpoint re-fetches the audio,
 * extracts a 1000-point peaks JSON, uploads it as a sidecar, and stamps
 * peaks_url on the row.
 *
 * Idempotent: if peaks_url already exists, returns the existing value
 * unless ?force=1 is passed.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const force = req.nextUrl.searchParams.get('force') === '1';

  try {
    let track: TrackPeaksRow | null = null;
    let updateSupabasePeaks: ((peaksUrl: string, bandsUrl: string | null) => Promise<NextResponse>) | null = null;
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', id);
      if (!owner.ok) return owner.res;
      const admin = owner.admin;
      const { data, error } = await admin.from('tracks').select('audio_url, peaks_url').eq('id', id).single();
      if (error) throw error;
      track = data as TrackPeaksRow;
      updateSupabasePeaks = async (peaksUrl, bandsUrl) => {
        const { data: updatedTrack, error: updateError } = await admin
          .from('tracks')
          // bands_url only written when we actually produced one, so a failed
          // spectral pass never clears a previously good sidecar.
          .update({ peaks_url: peaksUrl, ...(bandsUrl ? { bands_url: bandsUrl } : {}) })
          .eq('id', id)
          .select()
          .single();
        if (updateError) throw updateError;
        return NextResponse.json({ track: updatedTrack, peaks_url: peaksUrl, bands_url: bandsUrl });
      };
    } else {
      track = getById<TrackPeaksRow>('tracks', id);
    }

    if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    if (!track.audio_url) return NextResponse.json({ error: 'No audio_url on track' }, { status: 400 });
    if (track.peaks_url && !force) {
      return NextResponse.json({ track, peaks_url: track.peaks_url, skipped: 'already-present' });
    }

    const rawUrl: string = track.audio_url;
    let buf: Buffer;
    try {
      buf = await readStoredObject(rawUrl);
    } catch (err: unknown) {
      return NextResponse.json(
        { error: `Could not read audio: ${errorMessage(err) || 'storage error'}` },
        { status: 502 },
      );
    }

    // Regenerating peaks also regenerates the spectral sidecar, so a track
    // re-analysed after this ships stops falling back to in-browser analysis.
    const { peaksUrl, bandsUrl, undecodable } = await buildAndUploadSidecars(buf, rawUrl);
    if (undecodable) {
      return NextResponse.json({ error: 'Peak extraction returned nothing decodable' }, { status: 422 });
    }
    if (!peaksUrl) {
      return NextResponse.json({ error: 'Peaks sidecar upload failed' }, { status: 500 });
    }

    if (updateSupabasePeaks) {
      return updateSupabasePeaks(peaksUrl, bandsUrl);
    }

    const updated = update('tracks', id, {
      peaks_url: peaksUrl,
      ...(bandsUrl ? { bands_url: bandsUrl } : {}),
    });
    return NextResponse.json({ track: updated, peaks_url: peaksUrl, bands_url: bandsUrl });
  } catch (error) {
    log.error('peaks backfill failed', { trackId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
