import { NextRequest, NextResponse } from 'next/server';
import {
  scopedList,
  isErrorResponse,
  isSupabaseConfigured,
  createServiceClient,
  query,
} from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { parsePagination } from '@/lib/validate';

const log = createLogger('api.tracks.list');

/**
 * GET /api/tracks
 *
 * Lists the caller's tracks (+ null-owner legacy rows) with optional
 * filters. Junction filters (playlist_id, project_id, tag) resolve the
 * target track ids in a small first hop then feed them into scopedList
 * via `extraIn`. The main row fetch goes through the storage facade so
 * the user-scope filter is applied automatically and the local-store
 * fallback stays in sync.
 *
 * Pre-facade this route was ~160 lines with the supabase/local branches
 * duplicating every filter. Now it's ~90 lines and the two branches
 * share the filter set.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const playlistId = searchParams.get('playlist_id');
    const projectId = searchParams.get('project_id');
    const minRating = searchParams.get('min_rating');
    const minBpm = searchParams.get('min_bpm');
    const maxBpm = searchParams.get('max_bpm');
    const key = searchParams.get('key');
    const tag = searchParams.get('tag');

    // Resolve the optional junction filter to a track-id allowlist first.
    // Returning `[]` short-circuits — there's nothing to fetch if the
    // junction is empty.
    const junctionIds = await resolveJunctionIds({ playlistId, projectId, tag });
    if (junctionIds && junctionIds.length === 0) return NextResponse.json([]);

    // Compose the extraEq/Gte/Lte filters.
    const extraEq: Record<string, string | number | boolean> = {};
    if (type && type !== 'all') extraEq.type = type;
    if (key) extraEq.key = key;

    const extraGte: Record<string, number> = {};
    if (minRating) extraGte.rating = parseInt(minRating);
    if (minBpm) extraGte.bpm = parseInt(minBpm);

    const extraLte: Record<string, number> = {};
    if (maxBpm) extraLte.bpm = parseInt(maxBpm);

    // Optional pagination — omitted limit keeps prior behaviour (capped only
    // by PostgREST's own per-response ceiling).
    const { limit, offset } = parsePagination(searchParams);

    // Try the rich query with joins first. If Supabase complains (missing
    // table, RLS surprise), retry without joins so an active library
    // doesn't blink to "no tracks" on a transient schema hiccup.
    const richSelect = '*, track_tags(tag, category), stems(status)';

    let rows = await scopedList('tracks', {
      orderBy: 'created_at',
      ascending: false,
      select: richSelect,
      extraEq: Object.keys(extraEq).length ? extraEq : undefined,
      extraGte: Object.keys(extraGte).length ? extraGte : undefined,
      extraLte: Object.keys(extraLte).length ? extraLte : undefined,
      extraIn: junctionIds ? { column: 'id', values: junctionIds } : undefined,
      limit,
      offset,
    });

    if (isErrorResponse(rows)) {
      log.warn('rich query failed; retrying without joins');
      rows = await scopedList('tracks', {
        orderBy: 'created_at',
        ascending: false,
        extraEq: Object.keys(extraEq).length ? extraEq : undefined,
        extraGte: Object.keys(extraGte).length ? extraGte : undefined,
        extraLte: Object.keys(extraLte).length ? extraLte : undefined,
        extraIn: junctionIds ? { column: 'id', values: junctionIds } : undefined,
        limit,
        offset,
      });
      if (isErrorResponse(rows)) return rows;
    }

    // `private` keeps responses out of shared CDN caches (per-user data).
    // `max-age=15` lets browser back/forward nav serve instantly.
    // `stale-while-revalidate=60` keeps the screen instant while a quiet
    // background refresh updates the cache. The realtime hook still fires
    // an explicit invalidation on actual DB changes, so this only bounds
    // staleness when there's no realtime event.
    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
    });
  } catch (error) {
    log.error('list failed', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * Walk the junction table for whichever filter is set. Returns null when
 * no junction filter is active (caller skips the .in clause entirely).
 */
async function resolveJunctionIds({
  playlistId,
  projectId,
  tag,
}: {
  playlistId: string | null;
  projectId: string | null;
  tag: string | null;
}): Promise<string[] | null> {
  if (playlistId) {
    if (isSupabaseConfigured()) {
      const admin = createServiceClient();
      const { data } = await admin
        .from('playlist_tracks')
        .select('track_id')
        .eq('playlist_id', playlistId);
      return (data ?? []).map((r: { track_id: string }) => r.track_id);
    }
    const rows = query('playlist_tracks', (j) => (j as { playlist_id: string }).playlist_id === playlistId) as { track_id: string }[];
    return rows.map((j) => j.track_id);
  }

  if (projectId) {
    if (isSupabaseConfigured()) {
      const admin = createServiceClient();
      const { data } = await admin
        .from('project_tracks')
        .select('track_id')
        .eq('project_id', projectId);
      return (data ?? []).map((r: { track_id: string }) => r.track_id);
    }
    const rows = query('project_tracks', (j) => (j as { project_id: string }).project_id === projectId) as { track_id: string }[];
    return rows.map((j) => j.track_id);
  }

  if (tag) {
    if (isSupabaseConfigured()) {
      const admin = createServiceClient();
      const { data } = await admin
        .from('track_tags')
        .select('track_id')
        .eq('tag', tag);
      return (data ?? []).map((r: { track_id: string }) => r.track_id);
    }
    const rows = query('track_tags', (t) => (t as { tag: string }).tag === tag) as { track_id: string }[];
    return rows.map((t) => t.track_id);
  }

  return null;
}
