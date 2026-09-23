import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { redactPublicTrackMedia } from '@/lib/store/public-media';
import { loadPublicArtworkTheme } from '@/lib/artwork/public-theme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StoreProjectRow {
  id: string;
  user_id: string | null;
  name: string;
  cover_url: string | null;
  description: string | null;
  price_usd: number | string | null;
  store_featured: boolean | null;
  created_at: string | null;
}

interface ProjectTrackJunctionRow {
  track_id: string;
  position: number | null;
}

interface StoreProjectTrackRow extends Record<string, unknown> {
  id: string;
  title: string | null;
  type: string | null;
  audio_url: string | null;
  peaks_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  lease_price_usd: number | string | null;
  exclusive_price_usd: number | string | null;
  free_download_enabled: boolean | null;
}

interface CreatorProfileRow extends Record<string, unknown> {
  display_name: string | null;
  bio: string | null;
  hero_image_url: string | null;
  instagram_handle: string | null;
  twitter_handle: string | null;
  spotify_url: string | null;
  soundcloud_url: string | null;
  website_url: string | null;
  contact_email: string | null;
  accent_color: string | null;
}

function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^(https?:\/\/)+/, 'https://');
}

const TRACK_FIELDS = [
  'id', 'title', 'type',
  'audio_url', 'peaks_url', 'cover_url',
  'duration_seconds', 'bpm', 'key', 'scale',
  'lease_price_usd', 'exclusive_price_usd', 'free_download_enabled',
].join(', ');

/**
 * GET /api/store/projects/[id]
 *
 * Public-by-design endpoint for the /store/projects/[id] detail page.
 * Returns the project (only when store_featured = true), its tracks in
 * order, and the seller's creator profile.
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

    const { data: project, error: pErr } = await admin
      .from('projects')
      .select('id, user_id, name, cover_url, description, price_usd, store_featured, created_at')
      .eq('id', id)
      .eq('store_featured', true)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const projectRow = project as StoreProjectRow;
    const sellerId = projectRow.user_id ?? undefined;

    const junctionRes = await admin
      .from('project_tracks')
      .select('track_id, position')
      .eq('project_id', id)
      .order('position', { ascending: true });

    const junction = (junctionRes.data ?? []) as ProjectTrackJunctionRow[];
    const trackIds = junction.map((j) => j.track_id);

    const trackMap: Record<string, StoreProjectTrackRow> = {};
    if (trackIds.length > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .in('id', trackIds);
      for (const t of (trackRows ?? []) as unknown as StoreProjectTrackRow[]) {
        trackMap[t.id] = redactPublicTrackMedia({ ...t, cover_url: sanitizeUrl(t.cover_url) });
      }
    }

    const tracks = junction
      .map((j) => trackMap[j.track_id])
      .filter(Boolean);

    let creator: Record<string, unknown> | null = null;
    if (sellerId) {
      const { data: prof } = await admin
        .from('creator_profiles')
        .select([
          'display_name', 'bio', 'hero_image_url',
          'instagram_handle', 'twitter_handle', 'spotify_url',
          'soundcloud_url', 'website_url', 'contact_email',
          'accent_color',
        ].join(', '))
        .eq('user_id', sellerId)
        .maybeSingle();
      creator = (prof as CreatorProfileRow | null) ?? null;
      if (creator && creator.hero_image_url) {
        creator = { ...creator, hero_image_url: sanitizeUrl(creator.hero_image_url as string) };
      }
    }

    const safeProject = {
      id: projectRow.id,
      name: projectRow.name,
      cover_url: projectRow.cover_url,
      description: projectRow.description,
      price_usd: projectRow.price_usd,
      store_featured: projectRow.store_featured,
      created_at: projectRow.created_at,
    };

    const res = NextResponse.json({
      artworkTheme: await loadPublicArtworkTheme(admin, sellerId),
      project: { ...safeProject, cover_url: sanitizeUrl(safeProject.cover_url) },
      tracks,
      creator,
    });
    // Public project-bundle page → CDN-cacheable. Short s-maxage so price /
    // tracklist edits surface within ~30s; SWR serves instantly meanwhile.
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
