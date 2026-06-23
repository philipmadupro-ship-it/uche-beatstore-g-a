import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { slugify } from '@/lib/slug';
import { redactPublicTrackMedia } from '@/lib/store/public-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRACK_FIELDS = [
  'id', 'title', 'type',
  'audio_url', 'peaks_url', 'cover_url',
  'duration_seconds', 'bpm', 'key', 'scale',
  'rating', 'description',
  'lease_price_usd', 'exclusive_price_usd',
  'store_listed', 'free_download_enabled', 'created_at',
].join(', ');

/**
 * GET /api/store/producer/:slug
 *
 * Public endpoint for a producer's Bandcamp-style artist page.
 * Returns:
 *   { creator: CreatorProfile, tracks: Track[], playlists: Playlist[], projects: Project[] }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug).trim().toLowerCase();

  if (!decodedSlug) {
    return NextResponse.json({ error: 'Slug required' }, { status: 400 });
  }

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({
        creator: null,
        tracks: [],
        playlists: [],
        projects: [],
      });
    }

    const admin = createServiceClient();

    // 1. Resolve creator by slug (exact column match first, then generated fallback)
    let { data: creator, error: cErr } = await admin
      .from('creator_profiles')
      .select([
        'user_id', 'display_name', 'bio', 'hero_image_url', 'credits',
        'license_lease_price_usd', 'license_exclusive_price_usd', 'license_notes',
        'instagram_handle', 'twitter_handle', 'spotify_url',
        'soundcloud_url', 'website_url', 'contact_email',
        'accent_color', 'font_style', 'text_color_primary',
      ].join(', '))
      .eq('slug', decodedSlug)
      .maybeSingle();

    if (cErr) throw cErr;

    // Fallback: match creators whose display_name slugifies to the requested slug
    // (useful when the slug column hasn't been backfilled yet)
    if (!creator) {
      const { data: candidates } = await admin
        .from('creator_profiles')
        .select([
          'user_id', 'display_name', 'bio', 'hero_image_url', 'credits',
          'license_lease_price_usd', 'license_exclusive_price_usd', 'license_notes',
          'instagram_handle', 'twitter_handle', 'spotify_url',
          'soundcloud_url', 'website_url', 'contact_email',
          'accent_color', 'font_style', 'text_color_primary',
        ].join(', '))
        .not('display_name', 'is', null);

      creator = (candidates ?? []).find(
        (c: any) => slugify(c.display_name || '') === decodedSlug,
      ) ?? null;
    }

    if (!creator) {
      return NextResponse.json({ error: 'Producer not found' }, { status: 404 });
    }

    // Supabase's generic types can't follow the `.select(...).join(', ')`
    // pattern, so creator narrows to GenericStringError | null here.
    // Cast through `any` since we already proved it's truthy above.
    const sellerId = (creator as any).user_id as string;

    // 2. Fetch all store-listed tracks, playlists, projects in parallel
    const [tracksRes, playlistsRes, projectsRes] = await Promise.all([
      admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .eq('user_id', sellerId)
        .eq('store_listed', true)
        .order('created_at', { ascending: false }),
      admin
        .from('playlists')
        .select('id, name, cover_url, store_featured, store_order')
        .eq('user_id', sellerId)
        .eq('store_featured', true)
        .order('store_order', { ascending: true }),
      admin
        .from('projects')
        .select('id, name, cover_url, description, price_usd, store_featured, store_order')
        .eq('user_id', sellerId)
        .eq('store_featured', true)
        .order('store_order', { ascending: true }),
    ]);

    // Strip user_id from tracks before responding
    const safeTracks = (tracksRes.data ?? [])
      .map(({ user_id: _u, ...rest }: any) => rest)
      .map(redactPublicTrackMedia);

    const res = NextResponse.json({
      creator,
      tracks: safeTracks,
      playlists: playlistsRes.data ?? [],
      projects: projectsRes.data ?? [],
    });
    // Public producer page → CDN-cacheable. Short s-maxage so profile/listing
    // edits surface within ~30s; SWR serves instantly while revalidating.
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
