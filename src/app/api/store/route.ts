import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll } from '@/lib/local-store';
import { createServiceClient, safeSellerId } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

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
export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      const tracks = (getAll('tracks') as any[]).filter((t) => t.store_listed === true);
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
        const plTracks = tracks.filter((t) => plTrackIds.includes(t.id));
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
        const projTracks = tracks.filter((t) => projTrackIds.includes(t.id));
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

      const localResponse = NextResponse.json({ creator, tracks, featuredPlaylists, featuredProjects, licenses: [] });
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

    let withSortOrderQuery = admin
      .from('tracks')
      .select([
        'id', 'user_id', 'title', 'type',
        'audio_url', 'peaks_url', 'cover_url',
        'duration_seconds', 'bpm', 'key', 'scale',
        'rating', 'description',
        'lease_price_usd', 'exclusive_price_usd',
        'store_listed', 'store_featured', 'free_download_enabled', 'store_sort_order', 'voice_tag_enabled', 'exclusive_sold', 'created_at',
      ].join(', '))
      .eq('store_listed', true);
    if (sellerId) {
      withSortOrderQuery = withSortOrderQuery.or(`user_id.eq.${safeSeller},user_id.is.null`);
    }
    const withSortOrder = await withSortOrderQuery
      .order('store_sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (withSortOrder.error) {
      let fallbackQuery = admin
        .from('tracks')
        .select([
          'id', 'user_id', 'title', 'type',
          'audio_url', 'peaks_url', 'cover_url',
          'duration_seconds', 'bpm', 'key', 'scale',
          'rating', 'description',
          'lease_price_usd', 'exclusive_price_usd',
          'store_listed', 'free_download_enabled', 'created_at',
        ].join(', '))
        .eq('store_listed', true);
      if (sellerId) {
        fallbackQuery = fallbackQuery.or(`user_id.eq.${safeSeller},user_id.is.null`);
      }
      const fallback = await fallbackQuery
        .order('created_at', { ascending: false });
      if (fallback.error) throw fallback.error;
      tracksAny = (fallback.data as any[]) ?? [];
    } else {
      tracksAny = (withSortOrder.data as any[]) ?? [];
    }

    // ── wav_url (migration 039) ─────────────────────────────────────────
    // Re-fetch with wav_url if the column exists; otherwise it stays absent.
    // We do this as a lightweight separate check rather than in the main query
    // so the main tracks query stays resilient.

    // ── Play counts — for popular sort (not exposed to buyers) ─────────
    const trackIds = tracksAny.map((t: any) => t.id).filter(Boolean);
    let playCountByTrack: Record<string, number> = {};
    if (trackIds.length > 0) {
      try {
        const { data: playRows } = await admin
          .from('store_plays')
          .select('track_id')
          .in('track_id', trackIds);
        for (const row of (playRows ?? []) as any[]) {
          playCountByTrack[row.track_id] = (playCountByTrack[row.track_id] ?? 0) + 1;
        }
      } catch {
        // non-fatal — popular sort falls back to rating proxy
      }
    }

    // ── Tags — join track_tags for all returned tracks ──────────────────
    let tagsByTrack: Record<string, Array<{ tag: string; category: string | null }>> = {};
    if (trackIds.length > 0) {
      try {
        const { data: tagRows } = await admin
          .from('track_tags')
          .select('track_id, tag, category')
          .in('track_id', trackIds);
        for (const row of (tagRows ?? []) as any[]) {
          if (!tagsByTrack[row.track_id]) tagsByTrack[row.track_id] = [];
          tagsByTrack[row.track_id].push({ tag: row.tag, category: row.category ?? null });
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
            playlistTrackMap[t.id] = { ...t, cover_url: sanitizeUrl(t.cover_url) };
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
            projectTrackMap[t.id] = { ...t, cover_url: sanitizeUrl(t.cover_url) };
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

    // ── wav_url enrichment (migration 039) ───────────────────────────────
    let wavByTrack: Record<string, string | null> = {};
    if (trackIds.length > 0) {
      try {
        const { data: wavRows } = await admin
          .from('tracks')
          .select('id, wav_url')
          .in('id', trackIds);
        for (const r of (wavRows ?? []) as any[]) {
          if (r.wav_url) wavByTrack[r.id] = r.wav_url;
        }
      } catch (e) {
        console.error('[store] wav_url enrichment error:', e);
      }
    }

    // Strip owner uuid + sanitize cover_url + attach tags to each track
    // Voice tag (mig 072): attach the creator's tag to beats that opted in so
    // the preview player can overlay it client-side. Owner downloads stay clean.
    const tagUrl = (creator as any)?.voice_tag_url ?? null;
    const tagInterval = (creator as any)?.voice_tag_interval_seconds ?? 20;
    const safeTracks = tracksAny.map(({ user_id: _u, cover_url, ...rest }: any) => ({
      ...rest,
      cover_url: sanitizeUrl(cover_url),
      tags: tagsByTrack[rest.id] ?? [],
      wav_url: wavByTrack[rest.id] ?? null,
      play_count: playCountByTrack[rest.id] ?? 0,
      ...(rest.voice_tag_enabled && tagUrl ? { voice_tag_url: tagUrl, voice_tag_interval: tagInterval } : {}),
    }));

    // Public catalogue → CDN-cacheable. Short s-maxage so newly listed
    // tracks appear within ~30s; stale-while-revalidate keeps perceived
    // latency low while the cache refills.
    const response = NextResponse.json({ creator, tracks: safeTracks, featuredPlaylists, featuredProjects, licenses });
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return response;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
