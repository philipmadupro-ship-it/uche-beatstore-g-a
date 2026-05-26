import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

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
      .select('id, user_id, name, cover_url, store_featured, created_at')
      .eq('id', id)
      .eq('store_featured', true)
      .maybeSingle();

    if (plErr) throw plErr;
    if (!playlist) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const sellerId = (playlist as any).user_id as string | undefined;

    const junctionRes = await admin
      .from('playlist_tracks')
      .select('track_id, position')
      .eq('playlist_id', id)
      .order('position', { ascending: true });

    const junction = (junctionRes.data ?? []) as Array<{ track_id: string; position: number | null }>;
    const trackIds = junction.map((j) => j.track_id);

    const trackMap: Record<string, any> = {};
    if (trackIds.length > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .in('id', trackIds);
      for (const t of (trackRows ?? []) as any[]) {
        if (!t.store_listed) continue; // unlisted tracks invisible in public playlist
        trackMap[t.id] = { ...t, cover_url: sanitizeUrl(t.cover_url) };
      }
    }

    const tracks = junction
      .map((j) => trackMap[j.track_id])
      .filter(Boolean);

    let creator: Record<string, unknown> | null = null;
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
      creator = (prof as Record<string, unknown> | null) ?? null;
      if (creator) {
        if (creator.hero_image_url) {
          creator = { ...creator, hero_image_url: sanitizeUrl(creator.hero_image_url as string) };
        }
        profileLease = (creator as any).license_lease_price_usd ?? null;
        profileExclusive = (creator as any).license_exclusive_price_usd ?? null;
      }
    }

    const safePlaylist = {
      id: (playlist as any).id,
      name: (playlist as any).name,
      cover_url: sanitizeUrl((playlist as any).cover_url),
      created_at: (playlist as any).created_at,
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
