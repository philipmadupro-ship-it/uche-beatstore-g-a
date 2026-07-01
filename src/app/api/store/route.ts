import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll } from '@/lib/local-store';
import { createServiceClient, safeSellerId } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { redactPublicTrackMedia } from '@/lib/store/public-media';

export const runtime = 'nodejs';
// force-dynamic: no static pre-render; every request hits the DB so
// newly listed tracks appear immediately.
export const dynamic = 'force-dynamic';

/**
 * Strips double-protocol prefixes (e.g. "https://https://...") that can
 * appear when the R2 public URL env var already has a trailing slash and
 * the stored path accidentally prepends the full URL again.
 */
function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^(https?:\/\/)+/, 'https://');
}

function parsePagination(req: NextRequest) {
  const rawLimit = req.nextUrl.searchParams.get('limit');
  if (!rawLimit) return null;

  const parsedLimit = Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 60;
  const rawCursor = req.nextUrl.searchParams.get('cursor');
  const parsedOffset = rawCursor ? Number.parseInt(rawCursor, 10) : 0;
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

  return { limit, offset };
}

function cleanParam(value: string | null): string {
  return (value ?? '').trim().slice(0, 80);
}

function parseStoreFilters(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const sort = cleanParam(params.get('sort'));
  return {
    q: cleanParam(params.get('q')),
    type: cleanParam(params.get('type')),
    genre: cleanParam(params.get('genre')),
    mood: cleanParam(params.get('mood')),
    key: cleanParam(params.get('key')),
    scale: cleanParam(params.get('scale')),
    duration: cleanParam(params.get('duration')),
    freeOnly: params.get('free') === '1' || params.get('free') === 'true',
    newThisWeek: params.get('new') === '1' || params.get('new') === 'true',
    sort: sort || 'newest',
  };
}

function localFilterAndSortTracks(
  tracks: any[],
  tagsByTrack: Record<string, Array<{ tag: string; category: string | null }>>,
  filters: ReturnType<typeof parseStoreFilters>,
) {
  const q = filters.q.toLowerCase();
  const filtered = tracks.filter((track) => {
    const tags = tagsByTrack[track.id] ?? [];
    if (filters.type === 'beats' && track.type !== 'beat' && track.type !== 'instrumental') return false;
    if (filters.type && filters.type !== 'all' && filters.type !== 'beats' && track.type !== filters.type) return false;
    if (filters.freeOnly && !track.free_download_enabled) return false;
    if (filters.newThisWeek) {
      const created = track.created_at ? new Date(track.created_at).getTime() : 0;
      if (Date.now() - created > 7 * 24 * 60 * 60 * 1000) return false;
    }
    if (filters.key && String(track.key ?? '').toLowerCase() !== filters.key.toLowerCase()) return false;
    if (filters.scale && String(track.scale ?? '').toLowerCase() !== filters.scale.toLowerCase()) return false;
    if (filters.duration) {
      const duration = Number(track.duration_seconds ?? 0);
      if (filters.duration === 'short' && duration >= 120) return false;
      if (filters.duration === 'medium' && (duration < 120 || duration > 240)) return false;
      if (filters.duration === 'long' && duration <= 240) return false;
    }
    if (filters.genre && !tags.some((tag) => tag.category === 'genre' && tag.tag.toLowerCase() === filters.genre.toLowerCase())) return false;
    if (filters.mood && !tags.some((tag) => tag.category === 'mood' && tag.tag.toLowerCase() === filters.mood.toLowerCase())) return false;
    if (!q) return true;
    return (
      String(track.title ?? '').toLowerCase().includes(q) ||
      String(track.description ?? '').toLowerCase().includes(q) ||
      String(track.key ?? '').toLowerCase().includes(q) ||
      String(track.bpm ?? '').includes(q) ||
      tags.some((tag) => tag.tag.toLowerCase().includes(q))
    );
  });

  const sorted = [...filtered];
  switch (filters.sort) {
    case 'bpm-asc':
      sorted.sort((a, b) => Number(a.bpm ?? Infinity) - Number(b.bpm ?? Infinity));
      break;
    case 'bpm-desc':
      sorted.sort((a, b) => Number(b.bpm ?? -Infinity) - Number(a.bpm ?? -Infinity));
      break;
    case 'price-asc':
      sorted.sort((a, b) => Number(a.lease_price_usd ?? Infinity) - Number(b.lease_price_usd ?? Infinity));
      break;
    case 'price-desc':
      sorted.sort((a, b) => Number(b.lease_price_usd ?? -Infinity) - Number(a.lease_price_usd ?? -Infinity));
      break;
    case 'title':
      sorted.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
      break;
    case 'popular':
      sorted.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  }
  return sorted;
}

// `safeSellerId` now lives in @/lib/auth/ownership so every PostgREST
// `.or()` interpolation site can import it. See lib for full rationale.

/**
 * GET /api/store
 *
 * Public-by-design endpoint that powers the /store page. Returns:
 *   creator:           CreatorProfile | null
 *   tracks:            Array<Track + tags>
 *   featuredPlaylists: Array<{ id, name, cover_url, tracks[] }>
 *
 * Resilient to partially-applied migrations (033-036): each newer column
 * set is fetched with a try-catch fallback.
 */
export async function GET(req: NextRequest) {
  try {
    const pagination = parsePagination(req);
    const filters = parseStoreFilters(req);

    if (!isSupabaseConfigured()) {
      const allStoreTracks = (getAll('tracks') as any[]).filter((t) => t.store_listed === true);
      const localTagsByTrack: Record<string, Array<{ tag: string; category: string | null }>> = {};
      for (const row of ((getAll('track_tags' as any) as any[]) || [])) {
        if (!localTagsByTrack[row.track_id]) localTagsByTrack[row.track_id] = [];
        localTagsByTrack[row.track_id].push({ tag: row.tag, category: row.category ?? null });
      }
      const filteredStoreTracks = localFilterAndSortTracks(allStoreTracks, localTagsByTrack, filters);
      const tracks = pagination
        ? filteredStoreTracks.slice(pagination.offset, pagination.offset + pagination.limit)
        : filteredStoreTracks;
      const pageInfo = pagination
        ? {
          hasMore: pagination.offset + pagination.limit < filteredStoreTracks.length,
          nextCursor: pagination.offset + pagination.limit < filteredStoreTracks.length
            ? String(pagination.offset + pagination.limit)
            : null,
        }
        : null;
      const profiles = (getAll('creator_profiles' as any) as any[]) || [];
      const creator = profiles[0] ?? null;

      // Featured playlists + projects from the local store so devs without
      // Supabase configured still see meaningful data on /store.
      const allPlaylists = (getAll('playlists' as any) as any[]) || [];
      const playlistTracks = (getAll('playlist_tracks' as any) as any[]) || [];
      const featuredPlaylistRows = allPlaylists
        .filter((pl) => pl.store_featured === true)
        .sort((a, b) => (a.store_order ?? 999) - (b.store_order ?? 999));
      const featuredPlaylists = featuredPlaylistRows.map((pl) => {
        const plTrackIds = playlistTracks
          .filter((j) => j.playlist_id === pl.id)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((j) => j.track_id);
        const plTracks = allStoreTracks.filter((t) => plTrackIds.includes(t.id)).map(redactPublicTrackMedia);
        return { id: pl.id, name: pl.name, cover_url: pl.cover_url ?? null, store_order: pl.store_order ?? null, tracks: plTracks };
      });

      const allProjects = (getAll('projects' as any) as any[]) || [];
      const projectTracks = (getAll('project_tracks' as any) as any[]) || [];
      const featuredProjectRows = allProjects
        .filter((p) => p.store_featured === true)
        .sort((a, b) => (a.store_order ?? 999) - (b.store_order ?? 999));
      const featuredProjects = featuredProjectRows.map((proj) => {
        const projTrackIds = projectTracks
          .filter((j) => j.project_id === proj.id)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((j) => j.track_id);
        const projTracks = allStoreTracks.filter((t) => projTrackIds.includes(t.id)).map(redactPublicTrackMedia);
        return {
          id: proj.id,
          name: proj.name,
          cover_url: proj.cover_url ?? null,
          description: proj.description ?? null,
          price_usd: proj.price_usd ?? null,
          store_order: proj.store_order ?? null,
          tracks: projTracks,
        };
      });

      const localResponse = NextResponse.json({
        creator,
        tracks: tracks.map(redactPublicTrackMedia),
        featuredPlaylists,
        featuredProjects,
        licenses: [],
        ...(pageInfo ? { pageInfo } : {}),
      });
      // Same caching policy as the Supabase path: short s-maxage so newly
      // listed tracks appear within ~30s for CDN-cached visitors.
      localResponse.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return localResponse;
    }

    const admin = createServiceClient();

    // Pick the canonical creator_profile — the one that actually has a
    // display_name filled in. Without this, multi-profile databases (a
    // common artefact of dev seeding + repeated OAuth round-trips for
    // the same producer) lose the .limit(1) lottery to whichever empty
    // row landed first, and the .or() scope clause below then filters
    // out every real track because their user_id doesn't match the
    // orphan profile's user_id. NULLS LAST puts populated rows first.
    const profileOwner = await admin
      .from('creator_profiles')
      .select('user_id, display_name')
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    let sellerId = profileOwner.data?.user_id as string | undefined;
    // Pre-validate the seller id once so each downstream `.or()` call is
    // working with a known-safe UUID (Postgrest treats commas in `.or()`
    // values as filter separators).
    let safeSeller = safeSellerId(sellerId);

    // ── Tracks ─────────────────────────────────────────────────────────────
    // Try with store_sort_order first (migration 033). Fall back without it.
    let tracksAny: any[] = [];
    let requiredTrackIds: string[] | null = null;

    const intersectTrackIds = (ids: string[]) => {
      const unique = [...new Set(ids.filter(Boolean))];
      requiredTrackIds = requiredTrackIds == null
        ? unique
        : requiredTrackIds.filter((id) => unique.includes(id));
    };

    const applyTagFilter = async (category: 'genre' | 'mood', tag: string) => {
      if (!tag) return;
      const tagQuery = admin
        .from('track_tags')
        .select('track_id')
        .eq('category', category)
        .ilike('tag', tag);
      const { data: tagRows, error: tagError } = await tagQuery;
      if (tagError) throw tagError;
      intersectTrackIds(((tagRows ?? []) as any[]).map((row) => row.track_id));
    };

    await applyTagFilter('genre', filters.genre);
    await applyTagFilter('mood', filters.mood);

    const safeSearch = filters.q.replace(/[%,()]/g, ' ').trim();
    const applyTrackFilters = (query: any) => {
      let next = query;
      if (filters.type === 'beats') {
        next = next.in('type', ['beat', 'instrumental']);
      } else if (filters.type && filters.type !== 'all') {
        next = next.eq('type', filters.type);
      }
      if (filters.freeOnly) next = next.eq('free_download_enabled', true);
      if (filters.newThisWeek) {
        next = next.gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      }
      if (filters.key) next = next.ilike('key', filters.key);
      if (filters.scale) next = next.ilike('scale', filters.scale);
      if (filters.duration === 'short') next = next.lt('duration_seconds', 120);
      if (filters.duration === 'medium') next = next.gte('duration_seconds', 120).lte('duration_seconds', 240);
      if (filters.duration === 'long') next = next.gt('duration_seconds', 240);
      if (safeSearch) {
        const like = `%${safeSearch}%`;
        next = next.or(`title.ilike.${like},description.ilike.${like},key.ilike.${like}`);
      }
      if (requiredTrackIds) {
        next = next.in('id', requiredTrackIds.length > 0 ? requiredTrackIds : ['00000000-0000-0000-0000-000000000000']);
      }
      return next;
    };

    const applyTrackOrdering = (query: any, includeStoreOrder: boolean) => {
      switch (filters.sort) {
        case 'bpm-asc':
          return query.order('bpm', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        case 'bpm-desc':
          return query.order('bpm', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
        case 'price-asc':
          return query.order('lease_price_usd', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        case 'price-desc':
          return query.order('lease_price_usd', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
        case 'title':
          return query.order('title', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        case 'popular':
          return query.order('rating', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
        case 'newest':
        default:
          return includeStoreOrder
            ? query.order('store_sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
            : query.order('created_at', { ascending: false });
      }
    };

    let withSortOrderQuery = applyTrackFilters(admin
      .from('tracks')
      .select([
        'id', 'user_id', 'title', 'type',
        'audio_url', 'peaks_url', 'cover_url',
        'duration_seconds', 'bpm', 'key', 'scale',
        'rating', 'description',
        'lease_price_usd', 'exclusive_price_usd', 'wav_url',
        'store_listed', 'store_featured', 'free_download_enabled', 'store_sort_order', 'voice_tag_enabled', 'exclusive_sold', 'created_at',
      ].join(', '))
      .eq('store_listed', true));
    if (sellerId) {
      withSortOrderQuery = withSortOrderQuery.or(`user_id.eq.${safeSeller},user_id.is.null`);
    }
    let withSortOrderOrdered = applyTrackOrdering(withSortOrderQuery, true);
    if (pagination) {
      withSortOrderOrdered = withSortOrderOrdered.range(
        pagination.offset,
        pagination.offset + pagination.limit,
      );
    }
    const withSortOrder = await withSortOrderOrdered;

    if (withSortOrder.error) {
      let fallbackQuery = applyTrackFilters(admin
        .from('tracks')
        .select([
          'id', 'user_id', 'title', 'type',
          'audio_url', 'peaks_url', 'cover_url',
          'duration_seconds', 'bpm', 'key', 'scale',
          'rating', 'description',
          'lease_price_usd', 'exclusive_price_usd', 'wav_url',
          'store_listed', 'free_download_enabled', 'created_at',
        ].join(', '))
        .eq('store_listed', true));
      if (sellerId) {
        fallbackQuery = fallbackQuery.or(`user_id.eq.${safeSeller},user_id.is.null`);
      }
      let fallbackOrdered = applyTrackOrdering(fallbackQuery, false);
      if (pagination) {
        fallbackOrdered = fallbackOrdered.range(
          pagination.offset,
          pagination.offset + pagination.limit,
        );
      }
      const fallback = await fallbackOrdered;
      if (fallback.error) throw fallback.error;
      tracksAny = (fallback.data as any[]) ?? [];
    } else {
      tracksAny = (withSortOrder.data as any[]) ?? [];
    }

    const hasMoreTracks = pagination ? tracksAny.length > pagination.limit : false;
    if (pagination && hasMoreTracks) {
      tracksAny = tracksAny.slice(0, pagination.limit);
    }

    // ── Play counts — for popular sort (not exposed to buyers) ─────────
    // Batch in chunks of 100 so large catalogues don't hit the PostgREST
    // URL length limit and the query planner can use the index efficiently.
    const trackIds = tracksAny.map((t: any) => t.id).filter(Boolean);
    const BATCH = 100;
    const chunkIds = <T>(arr: T[]): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += BATCH) out.push(arr.slice(i, i + BATCH));
      return out;
    };

    let playCountByTrack: Record<string, number> = {};
    if (trackIds.length > 0) {
      try {
        for (const chunk of chunkIds(trackIds)) {
          const { data: playRows, error: playCountError } = await admin
            .from('store_play_counts')
            .select('track_id, play_count')
            .in('track_id', chunk);
          if (playCountError) throw playCountError;
          for (const row of (playRows ?? []) as any[]) {
            playCountByTrack[row.track_id] = Number(row.play_count ?? 0);
          }
        }
      } catch {
        // Migration 102 may not be applied yet. Fall back to the older raw-row
        // count path so popular sorting degrades gracefully.
        try {
          for (const chunk of chunkIds(trackIds)) {
            const { data: playRows } = await admin
              .from('store_plays')
              .select('track_id')
              .in('track_id', chunk);
            for (const row of (playRows ?? []) as any[]) {
              playCountByTrack[row.track_id] = (playCountByTrack[row.track_id] ?? 0) + 1;
            }
          }
        } catch {
          // non-fatal — popular sort falls back to rating proxy
        }
      }
    }

    // ── Tags — join track_tags for all returned tracks ──────────────────
    let tagsByTrack: Record<string, Array<{ tag: string; category: string | null }>> = {};
    if (trackIds.length > 0) {
      try {
        for (const chunk of chunkIds(trackIds)) {
          const { data: tagRows } = await admin
            .from('track_tags')
            .select('track_id, tag, category')
            .in('track_id', chunk);
          for (const row of (tagRows ?? []) as any[]) {
            if (!tagsByTrack[row.track_id]) tagsByTrack[row.track_id] = [];
            tagsByTrack[row.track_id].push({ tag: row.tag, category: row.category ?? null });
          }
        }
      } catch {
        // tags are optional enrichment; non-fatal
      }
    }

    // ── Creator profile ─────────────────────────────────────────────────────
    sellerId = sellerId ?? tracksAny.find((t: any) => !!t.user_id)?.user_id;
    // Re-derive the safe form now that sellerId may have changed.
    safeSeller = safeSellerId(sellerId);

    let creator: Record<string, unknown> | null = null;
    let featuredPlaylists: Record<string, unknown>[] = [];

    if (sellerId) {
      // Try with newer columns first (migrations 034, 035, 036).
      const profileWithNew = await admin
        .from('creator_profiles')
        .select([
          'display_name', 'bio', 'hero_image_url', 'credits',
          'license_lease_price_usd', 'license_exclusive_price_usd', 'license_notes',
          'instagram_handle', 'twitter_handle', 'spotify_url',
          'soundcloud_url', 'website_url', 'contact_email',
          'accent_color', 'font_style', 'text_color_primary',
          'voice_tag_url', 'voice_tag_interval_seconds',
          'bundle_discount_threshold', 'bundle_discount_percent',
        ].join(', '))
        .eq('user_id', sellerId)
        .maybeSingle();

      if (profileWithNew.error) {
        // Fall back without the newer columns
        const profileBase = await admin
          .from('creator_profiles')
          .select([
            'display_name', 'bio', 'hero_image_url', 'credits',
            'license_lease_price_usd', 'license_exclusive_price_usd', 'license_notes',
            'instagram_handle', 'twitter_handle', 'spotify_url',
            'soundcloud_url', 'website_url', 'contact_email',
          ].join(', '))
          .eq('user_id', sellerId)
          .maybeSingle();
        creator = (profileBase.data as Record<string, unknown> | null) ?? null;
      } else {
        creator = (profileWithNew.data as Record<string, unknown> | null) ?? null;
      }

      // Sanitize hero image URL
      if (creator && creator.hero_image_url) {
        creator = { ...creator, hero_image_url: sanitizeUrl(creator.hero_image_url as string) };
      }

    }

    // ── Featured playlists + their tracks (migration 035) ──────────────
    try {
      let playlistsQuery = admin
        .from('playlists')
        .select('id, name, cover_url, store_order')
        .eq('store_featured', true)
        .order('store_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (sellerId) {
        playlistsQuery = playlistsQuery.or(`user_id.eq.${safeSeller},user_id.is.null`);
      }
      const playlistsResult = await playlistsQuery;

      if (playlistsResult.error) {
        console.error('[store] featured playlists query error:', playlistsResult.error.message);
      } else if (playlistsResult.data?.length) {
        const playlists = playlistsResult.data as any[];
        const plIds = playlists.map((p: any) => p.id);

        const junctionRes = await admin
          .from('playlist_tracks')
          .select('playlist_id, track_id, position')
          .in('playlist_id', plIds)
          .order('position', { ascending: true });

        const junction = (junctionRes.data ?? []) as any[];
        const playlistTrackIds = [...new Set(junction.map((j: any) => j.track_id))];

        let playlistTrackMap: Record<string, any> = {};
        if (playlistTrackIds.length > 0) {
          const { data: ptRows } = await admin
            .from('tracks')
            .select('id, title, type, audio_url, peaks_url, cover_url, duration_seconds, bpm, key, scale, lease_price_usd, exclusive_price_usd, free_download_enabled')
            .in('id', playlistTrackIds);
          for (const t of (ptRows ?? []) as any[]) {
            playlistTrackMap[t.id] = redactPublicTrackMedia({ ...t, cover_url: sanitizeUrl(t.cover_url) });
          }
        }

        featuredPlaylists = playlists.map((pl: any) => {
          const plTracks = junction
            .filter((j: any) => j.playlist_id === pl.id)
            .map((j: any) => playlistTrackMap[j.track_id])
            .filter(Boolean);
          return {
            ...pl,
            cover_url: sanitizeUrl(pl.cover_url),
            tracks: plTracks,
          };
        });
      }
    } catch (e) {
      console.error('[store] featured playlists error:', e);
    }

    // ── Store-featured projects (migration 040) ──────────────────────────
    // Only requires store_featured = true. is_public is auto-set when a
    // producer clicks "Add to store", so we don't double-gate here.
    let featuredProjects: Record<string, unknown>[] = [];
    try {
      let projectsQuery = admin
        .from('projects')
        .select('id, name, cover_url, description, price_usd, store_featured, store_order, created_at')
        .eq('store_featured', true)
        .order('store_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(12);
      if (sellerId) {
        projectsQuery = projectsQuery.or(`user_id.eq.${safeSeller},user_id.is.null`);
      }
      const projectsResult = await projectsQuery;

      if (projectsResult.error) {
        console.error('[store] featured projects query error:', projectsResult.error.message);
      } else if (projectsResult.data?.length) {
        const projects = projectsResult.data as any[];
        const projIds = projects.map((p: any) => p.id);

        const junctionRes = await admin
          .from('project_tracks')
          .select('project_id, track_id, position')
          .in('project_id', projIds)
          .order('position', { ascending: true });

        const junction = (junctionRes.data ?? []) as any[];
        const projectTrackIds = [...new Set(junction.map((j: any) => j.track_id))];

        let projectTrackMap: Record<string, any> = {};
        if (projectTrackIds.length > 0) {
          const { data: ptRows } = await admin
            .from('tracks')
            .select('id, title, type, audio_url, peaks_url, cover_url, duration_seconds, bpm, key, scale, lease_price_usd, exclusive_price_usd, free_download_enabled')
            .in('id', projectTrackIds);
          for (const t of (ptRows ?? []) as any[]) {
            projectTrackMap[t.id] = redactPublicTrackMedia({ ...t, cover_url: sanitizeUrl(t.cover_url) });
          }
        }

        featuredProjects = projects.map((proj: any) => {
          const projTracks = junction
            .filter((j: any) => j.project_id === proj.id)
            .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
            .map((j: any) => projectTrackMap[j.track_id])
            .filter(Boolean);
          return {
            id: proj.id,
            name: proj.name,
            cover_url: sanitizeUrl(proj.cover_url),
            description: proj.description ?? null,
            price_usd: proj.price_usd ?? null,
            store_order: proj.store_order ?? null,
            tracks: projTracks,
          };
        });
      }
    } catch (e) {
      console.error('[store] featured projects error:', e);
    }

    // ── Licenses (from licenses table, migration 031) ────────────────────
    let licenses: any[] = [];
    if (sellerId) {
      try {
        const { data: licenseRows } = await admin
          .from('licenses')
          .select('id, name, description, price_usd, is_free, file_types, stems_included, is_exclusive, sort_order, streaming_limit, distribution_limit, commercial_rights, sync_rights, broadcast_rights, credit_required')
          .eq('user_id', sellerId)
          .order('sort_order', { ascending: true });
        licenses = licenseRows ?? [];
      } catch (e) {
        console.error('[store] licenses error:', e);
      }
    }

    // Strip owner uuid + sanitize cover_url + attach tags to each track
    // Voice tag (mig 072): attach the creator's tag to beats that opted in so
    // the preview player can overlay it client-side. Owner downloads stay clean.
    const tagUrl = (creator as any)?.voice_tag_url ?? null;
    const tagInterval = (creator as any)?.voice_tag_interval_seconds ?? 20;
    const safeTracks = tracksAny.map(({ user_id: _u, cover_url, ...rest }: any) => redactPublicTrackMedia({
      ...rest,
      cover_url: sanitizeUrl(cover_url),
      // Derive WAV availability before redaction nulls wav_url, so the store
      // can show a "WAV" badge without exposing the private master URL.
      has_wav: Boolean(rest.wav_url),
      tags: tagsByTrack[rest.id] ?? [],
      play_count: playCountByTrack[rest.id] ?? 0,
      ...(rest.voice_tag_enabled && tagUrl ? { voice_tag_url: tagUrl, voice_tag_interval: tagInterval } : {}),
    }));

    // Public catalogue → CDN-cacheable. Short s-maxage so newly listed
    // tracks appear within ~30s; stale-while-revalidate keeps perceived
    // latency low while the cache refills.
    const response = NextResponse.json({
      creator,
      tracks: safeTracks,
      featuredPlaylists,
      featuredProjects,
      licenses,
      ...(pagination
        ? {
          pageInfo: {
            hasMore: hasMoreTracks,
            nextCursor: hasMoreTracks ? String(pagination.offset + pagination.limit) : null,
          },
        }
        : {}),
    });
    // CDN cache: keep fresh for 5 min, then serve stale instantly for up to a
    // day while revalidating in the background. On a low-traffic store the old
    // 30s window expired between visits, so nearly every visitor paid the full
    // cold query cost (~5s). A long stale-while-revalidate means a visitor
    // almost never waits — they get the cached copy immediately and the refresh
    // happens out of band. Newly listed tracks appear within ~5 min.
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return response;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
