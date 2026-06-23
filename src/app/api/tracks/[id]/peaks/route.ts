import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getById, update, requireRowOwnership } from '@/lib/db';
import { extractPeaks } from '@/lib/audio/peaks';
import { readStoredObject, uploadPeaksSidecar } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.peaks');

export const runtime = 'nodejs';
export const maxDuration = 60;

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
    let track: any;
    let admin: any = null;
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', id);
      if (!owner.ok) return owner.res;
      admin = owner.admin;
      const { data, error } = await admin.from('tracks').select('*').eq('id', id).single();
      if (error) throw error;
      track = data;
    } else {
      track = getById('tracks', id);
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
    } catch (err: any) {
      return NextResponse.json(
        { error: `Could not read audio: ${err?.message || 'storage error'}` },
        { status: 502 },
      );
    }

    const peaks = await extractPeaks(buf);
    if (!peaks) {
      return NextResponse.json({ error: 'Peak extraction returned nothing decodable' }, { status: 422 });
    }
    const peaksUrl = await uploadPeaksSidecar(rawUrl, JSON.stringify(peaks));
    if (!peaksUrl) {
      return NextResponse.json({ error: 'Peaks sidecar upload failed' }, { status: 500 });
    }

    if (isSupabaseConfigured()) {
      const { data, error } = await admin!
        .from('tracks')
        .update({ peaks_url: peaksUrl })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ track: data, peaks_url: peaksUrl });
    }

    const updated = update('tracks', id, { peaks_url: peaksUrl });
    return NextResponse.json({ track: updated, peaks_url: peaksUrl });
  } catch (error) {
    log.error('peaks backfill failed', { trackId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
