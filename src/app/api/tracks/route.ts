import { NextRequest, NextResponse } from 'next/server';
import {
  scopedList,
  isErrorResponse,
  isSupabaseConfigured,
  createServiceClient,
  requireUser,
  query,
} from '@/lib/db';
import { safeSellerId } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { parsePagination } from '@/lib/validate';

const log = createLogger('api.tracks.list');

function parsePositiveInt(value: string | null, fallback: number, max = 100) {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function parseOffset(value: string | null) {
  const parsed = value ? Number.parseInt(value, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function cleanSearch(value: string | null) {
  return (value ?? '').trim().slice(0, 80);
}

function shouldUseBoundedList(searchParams: URLSearchParams) {
  return Boolean(
    searchParams.get('limit') ||
    searchParams.get('cursor') ||
    searchParams.get('q') ||
    searchParams.get('paged') === '1' ||
    searchParams.get('lean') === '1',
  );
}

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
    const storeListed = searchParams.get('store_listed');

    if (shouldUseBoundedList(searchParams)) {
      return listBoundedTracks(req, {
        type,
        playlistId,
        projectId,
        minRating,
        minBpm,
        maxBpm,
        key,
        tag,
        storeListed,
      });
    }

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

async function listBoundedTracks(
  req: NextRequest,
  filters: {
    type: string | null;
    playlistId: string | null;
    projectId: string | null;
    minRating: string | null;
    minBpm: string | null;
    maxBpm: string | null;
    key: string | null;
    tag: string | null;
    storeListed: string | null;
  },
) {
  const { searchParams } = new URL(req.url);
  const limit = parsePositiveInt(searchParams.get('limit'), 50, 100);
  const cursor = parseOffset(searchParams.get('cursor'));
  const q = cleanSearch(searchParams.get('q')).toLowerCase();
  const paged = searchParams.get('paged') === '1';

  const junctionIds = await resolveJunctionIds({
    playlistId: filters.playlistId,
    projectId: filters.projectId,
    tag: filters.tag,
  });
  if (junctionIds && junctionIds.length === 0) {
    const empty = { tracks: [], pageInfo: { hasMore: false, nextCursor: null } };
    return NextResponse.json(paged ? empty : [], {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
    });
  }

  if (!isSupabaseConfigured()) {
    let rows = query('tracks', () => true) as any[];
    rows = rows.filter((track) => {
      if (junctionIds && !junctionIds.includes(track.id)) return false;
      if (filters.type && filters.type !== 'all' && track.type !== filters.type) return false;
      if (filters.key && track.key !== filters.key) return false;
      if (filters.minRating && Number(track.rating ?? 0) < Number(filters.minRating)) return false;
      if (filters.minBpm && Number(track.bpm ?? 0) < Number(filters.minBpm)) return false;
      if (filters.maxBpm && Number(track.bpm ?? 0) > Number(filters.maxBpm)) return false;
      if (filters.storeListed === '1' && !track.store_listed) return false;
      if (filters.storeListed === '0' && track.store_listed) return false;
      if (!q) return true;
      return (
        String(track.title ?? '').toLowerCase().includes(q) ||
        String(track.description ?? '').toLowerCase().includes(q) ||
        String(track.key ?? '').toLowerCase().includes(q) ||
        String(track.bpm ?? '').includes(q)
      );
    });
    rows.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    const page = rows.slice(cursor, cursor + limit);
    const hasMore = cursor + limit < rows.length;
    const payload = {
      tracks: page,
      pageInfo: { hasMore, nextCursor: hasMore ? String(cursor + limit) : null },
    };
    return NextResponse.json(paged ? payload : page, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
    });
  }

  const owner = await requireUser();
  if (!owner.ok) return owner.res;
  const safeUserId = safeSellerId(owner.userId);
  if (!safeUserId) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });

  let dbQuery = owner.admin
    .from('tracks')
    .select([
      'id', 'title', 'type', 'cover_url', 'duration_seconds',
      'bpm', 'key', 'scale', 'rating', 'store_listed',
      'store_featured', 'store_sort_order', 'scheduled_publish_at',
      'lease_price_usd', 'exclusive_price_usd', 'free_download_enabled',
      'exclusive_sold', 'voice_tag_enabled', 'created_at',
      // audio_url + preview_status drive the library's "Analyze N" / preview
      // backfill affordance (owner-only response, so the private ref is fine).
      'audio_url', 'preview_status',
      'track_tags(tag, category)', 'stems(status)',
    ].join(', '))
    .or(`user_id.eq.${safeUserId},user_id.is.null`);

  if (filters.type && filters.type !== 'all') dbQuery = dbQuery.eq('type', filters.type);
  if (filters.key) dbQuery = dbQuery.eq('key', filters.key);
  if (filters.minRating) dbQuery = dbQuery.gte('rating', Number(filters.minRating));
  if (filters.minBpm) dbQuery = dbQuery.gte('bpm', Number(filters.minBpm));
  if (filters.maxBpm) dbQuery = dbQuery.lte('bpm', Number(filters.maxBpm));
  if (filters.storeListed === '1') dbQuery = dbQuery.eq('store_listed', true);
  if (filters.storeListed === '0') dbQuery = dbQuery.eq('store_listed', false);
  if (junctionIds) dbQuery = dbQuery.in('id', junctionIds);
  if (q) {
    const safeQ = q.replace(/[%,()]/g, ' ').trim();
    if (safeQ) {
      const bpmFilter = /^\d{2,3}$/.test(safeQ) ? `,bpm.eq.${Number(safeQ)}` : '';
      dbQuery = dbQuery.or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%,key.ilike.%${safeQ}%${bpmFilter}`);
    }
  }

  const { data, error } = await dbQuery
    .order('created_at', { ascending: false })
    .range(cursor, cursor + limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as any[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const payload = {
    tracks: page,
    pageInfo: { hasMore, nextCursor: hasMore ? String(cursor + limit) : null },
  };

  return NextResponse.json(paged ? payload : page, {
    headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
  });
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
