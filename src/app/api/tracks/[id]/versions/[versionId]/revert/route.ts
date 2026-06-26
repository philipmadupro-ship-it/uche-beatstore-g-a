import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getById, getAll, insert, update } from '@/lib/local-store';
import { nextVersionLabel } from '@/lib/naming';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.tracks.id.versions.versionId.revert');

export const runtime = 'nodejs';

/**
 * POST /api/tracks/[id]/versions/[versionId]/revert
 *
 * Atomically:
 *   1. Snapshot the *current* track state into a new track_versions row
 *      (so we never lose the live state when reverting).
 *   2. Copy the target version's audio_url + analysis fields back onto the
 *      track row.
 *
 * Effectively a "make this version live again" — non-destructive, the
 * previously-live state is now itself a version you can revert back to.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', id);
      if (!owner.ok) return owner.res;
      const sb = owner.admin;

      const [{ data: current }, { data: target }, { data: allVersions }] = await Promise.all([
        sb.from('tracks').select('*').eq('id', id).single(),
        sb.from('track_versions').select('*').eq('id', versionId).eq('track_id', id).single(),
        sb.from('track_versions').select('version_number').eq('track_id', id),
      ]);

      if (!current) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
      if (!target)  return NextResponse.json({ error: 'Version not found' }, { status: 404 });

      // 1. Snapshot the live state
      const { number, label } = nextVersionLabel(allVersions ?? []);
      await sb.from('track_versions').insert({
        track_id: id,
        version_number: number,
        version_label: label,
        audio_url: current.audio_url,
        duration_seconds: current.duration_seconds,
        bpm: current.bpm,
        key: current.key,
        scale: current.scale,
        loudness: current.loudness,
        energy: current.energy,
        danceability: current.danceability,
        valence: current.valence,
        acousticness: current.acousticness,
        notes: current.notes,
        created_by: null,
      });

      // 2. Promote the target version to live
      const patch = {
        audio_url: target.audio_url,
        duration_seconds: target.duration_seconds,
        bpm: target.bpm,
        key: target.key,
        scale: target.scale,
        loudness: target.loudness,
        energy: target.energy,
        danceability: target.danceability,
        valence: target.valence,
        acousticness: target.acousticness,
        // Preserve notes/title/cover/rating from the live row
      };
      const { data: updated, error } = await sb
        .from('tracks')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      return NextResponse.json({ track: updated });
    }

    // Local-store fallback
    const current = getById('tracks', id);
    const target = (getAll('track_versions') as any[]).find((v) => v.id === versionId && v.track_id === id);
    if (!current) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    if (!target)  return NextResponse.json({ error: 'Version not found' }, { status: 404 });

    const allV = (getAll('track_versions') as any[]).filter((v) => v.track_id === id);
    const { number, label } = nextVersionLabel(allV);
    insert('track_versions', {
      track_id: id,
      version_number: number,
      version_label: label,
      audio_url: current.audio_url,
      duration_seconds: current.duration_seconds,
      bpm: current.bpm,
      key: current.key,
      scale: current.scale,
      loudness: current.loudness,
      energy: current.energy,
      danceability: current.danceability,
      valence: current.valence,
      acousticness: current.acousticness,
      notes: current.notes,
      created_by: null,
    });

    const updated = update('tracks', id, {
      audio_url: target.audio_url,
      duration_seconds: target.duration_seconds,
      bpm: target.bpm,
      key: target.key,
      scale: target.scale,
      loudness: target.loudness,
      energy: target.energy,
      danceability: target.danceability,
      valence: target.valence,
      acousticness: target.acousticness,
    });

    return NextResponse.json({ track: updated });
  } catch (error: any) {
    log.error('Revert error:', { error: errorMessage(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
