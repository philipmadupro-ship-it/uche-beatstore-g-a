import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { redactPublicTrackMedia } from '@/lib/store/public-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^(https?:\/\/)+/, 'https://');
}

const TRACK_FIELDS = [
  'id', 'title', 'type',
  'audio_url', 'peaks_url', 'cover_url',
  'duration_seconds', 'bpm', 'key', 'scale',
  'lease_price_usd', 'exclusive_price_usd', 'free_download_enabled',
  'store_listed',
].join(', ');

interface StorePlaylistRow {
  id: string;
  user_id?: string | null;
  name: string;
  description?: string | null;
  cover_url?: string | null;
  store_featured?: boolean | null;
  created_at?: string | null;
}

interface PlaylistTrackRow {
  track_id: string;
  position: number | null;
}

interface StorePlaylistTrack extends Record<string, unknown> {
  id: string;
  title?: string | null;
  type?: string | null;
  audio_url?: string | null;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
  free_download_enabled?: boolean | null;
  store_listed?: boolean | null;
}

interface StorePlaylistCreator {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  accent_color?: string | null;
  license_lease_price_usd?: number | null;
  license_exclusive_price_usd?: number | null;
}

/**
 * GET /api/store/playlists/[id]
 *
 * Public detail endpoint for a store-featured playlist. Unlike
 * /api/store/projects/[id] (sold as a fixed-price bundle), playlists
 * are sold per-track — each track keeps its own lease + exclusive
 * pricing and the buyer picks which ones to add to the cart. Returns
 * the playlist row, its tracks in order, and the seller's creator
 * profile.
 *
 * Only store_featured=true playlists are exposed. Individual tracks
 * also need store_listed=true to be returned (we silently drop the
 * rest — if the producer removed a track from their store it shouldn't
 * appear in the public playlist either).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const admin = createServiceClient();

    const { data: playlist, error: plErr } = await admin
      .from('playlists')
      .select('id, user_id, name, description, cover_url, store_featured, created_at')
      .eq('id', id)
      .eq('store_featured', true)
      .maybeSingle();

    if (plErr) throw plErr;
    if (!playlist) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const playlistRow = playlist as StorePlaylistRow;
    const sellerId = playlistRow.user_id ?? undefined;

    const junctionRes = await admin
      .from('playlist_tracks')
      .select('track_id, position')
      .eq('playlist_id', id)
      .order('position', { ascending: true });

    const junction = (junctionRes.data ?? []) as PlaylistTrackRow[];
    const trackIds = junction.map((j) => j.track_id);

    const trackMap: Record<string, ReturnType<typeof redactPublicTrackMedia<StorePlaylistTrack>>> = {};
    if (trackIds.length > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .in('id', trackIds);
      for (const t of (trackRows ?? []) as unknown as StorePlaylistTrack[]) {
        if (!t.store_listed) continue; // unlisted tracks invisible in public playlist
        trackMap[t.id] = redactPublicTrackMedia({ ...t, cover_url: sanitizeUrl(t.cover_url) });
      }
    }

    const tracks = junction
      .map((j) => trackMap[j.track_id])
      .filter(Boolean);

    let creator: StorePlaylistCreator | null = null;
    let profileLease: number | null = null;
    let profileExclusive: number | null = null;
    if (sellerId) {
      const { data: prof } = await admin
        .from('creator_profiles')
        .select([
          'display_name', 'bio', 'hero_image_url',
          'instagram_handle', 'twitter_handle', 'spotify_url',
          'soundcloud_url', 'website_url', 'contact_email',
          'accent_color',
          'license_lease_price_usd', 'license_exclusive_price_usd',
        ].join(', '))
        .eq('user_id', sellerId)
        .maybeSingle();
      creator = (prof as StorePlaylistCreator | null) ?? null;
      if (creator) {
        if (creator.hero_image_url) {
          creator = { ...creator, hero_image_url: sanitizeUrl(creator.hero_image_url) };
        }
        profileLease = creator.license_lease_price_usd ?? null;
        profileExclusive = creator.license_exclusive_price_usd ?? null;
      }
    }

    const safePlaylist = {
      id: playlistRow.id,
      name: playlistRow.name,
      description: playlistRow.description ?? null,
      cover_url: sanitizeUrl(playlistRow.cover_url),
      created_at: playlistRow.created_at,
    };

    return NextResponse.json({
      playlist: safePlaylist,
      tracks,
      creator,
      pricing_fallback: {
        lease: profileLease,
        exclusive: profileExclusive,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
