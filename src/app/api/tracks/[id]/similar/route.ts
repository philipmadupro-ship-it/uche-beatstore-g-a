import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getById, getAll } from '@/lib/local-store';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { findSimilar } from '@/lib/audio/similarity';
import type { Track } from '@/lib/types';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.tracks.id.similar');

export const runtime = 'nodejs';

/**
 * GET /api/tracks/[id]/similar?limit=5
 *
 * Returns the most acoustically similar tracks in the caller's library to
 * the target track, ranked by combined BPM + key + vibe distance (see
 * lib/audio/similarity.ts for the math).
 *
 * Owner-gated: we use requireRowOwnership both to verify the caller can
 * see the target and to scope the candidate pool to *their* tracks.
 * Cross-user discovery would need a separate endpoint with explicit
 * sharing rules.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 5);
  // Cap raised to 50 so the discovery surface has a real pool to filter/browse.
  const limit = Math.max(1, Math.min(50, isFinite(limitParam) ? limitParam : 5));

  try {
    let target: Track | null = null;
    let pool: Track[] = [];

    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', id);
      if (!owner.ok) return owner.res;

      const { data: targetRow, error: tErr } = await owner.admin
        .from('tracks')
        .select('*')
        .eq('id', id)
        .single();
      if (tErr) throw tErr;
      target = targetRow as Track;

      // Pool = caller's tracks (incl. legacy null-owner rows, matching the
      // loosened RLS semantics elsewhere). Service-role + manual filter.
      const { data: rows, error: pErr } = await owner.admin
        .from('tracks')
        .select('*')
        .or(`user_id.eq.${owner.userId},user_id.is.null`);
      if (pErr) throw pErr;
      pool = (rows ?? []) as Track[];
    } else {
      target = (getById('tracks', id) as Track | null) ?? null;
      pool = getAll('tracks') as Track[];
    }

    if (!target) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    }

    const similar = findSimilar(target, pool, limit);

    // Attach tags per result so the discovery surface can filter by tag.
    // Best-effort batch query; missing table / no tags → empty arrays.
    const tagsByTrack: Record<string, string[]> = {};
    if (isSupabaseConfigured() && similar.length > 0) {
      try {
        const owner = await requireRowOwnership('tracks', id);
        if (owner.ok) {
          const ids = similar.map((s) => s.track.id);
          const { data: tagRows } = await owner.admin
            .from('track_tags')
            .select('track_id, tag')
            .in('track_id', ids);
          for (const r of (tagRows ?? []) as Array<{ track_id: string; tag: string }>) {
            (tagsByTrack[r.track_id] ??= []).push(r.tag);
          }
        }
      } catch {
        // non-fatal — tag filtering just won't be available
      }
    }

    return NextResponse.json({
      target_id: target.id,
      results: similar.map((s) => ({
        track: {
          id: s.track.id,
          title: s.track.title,
          type: s.track.type,
          status: s.track.status ?? null,
          cover_url: s.track.cover_url ?? null,
          bpm: s.track.bpm ?? null,
          key: s.track.key ?? null,
          scale: s.track.scale ?? null,
          tags: tagsByTrack[s.track.id] ?? [],
        },
        distance: Number(s.distance.toFixed(4)),
        breakdown: {
          bpm: Number(s.breakdown.bpm.toFixed(3)),
          key: Number(s.breakdown.key.toFixed(3)),
          vibe: Number(s.breakdown.vibe.toFixed(3)),
          type: Number(s.breakdown.type.toFixed(3)),
        },
      })),
    });
  } catch (error: any) {
    log.error('Similar tracks error:', { error: errorMessage(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
