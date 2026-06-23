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

    const sellerId = (project as any).user_id as string | undefined;

    const junctionRes = await admin
      .from('project_tracks')
      .select('track_id, position')
      .eq('project_id', id)
      .order('position', { ascending: true });

    const junction = (junctionRes.data ?? []) as Array<{ track_id: string; position: number | null }>;
    const trackIds = junction.map((j) => j.track_id);

    let trackMap: Record<string, any> = {};
    if (trackIds.length > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .in('id', trackIds);
      for (const t of (trackRows ?? []) as any[]) {
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
      creator = (prof as Record<string, unknown> | null) ?? null;
      if (creator && creator.hero_image_url) {
        creator = { ...creator, hero_image_url: sanitizeUrl(creator.hero_image_url as string) };
      }
    }

    const { user_id: _u, ...safeProject } = project as any;

    const res = NextResponse.json({
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
