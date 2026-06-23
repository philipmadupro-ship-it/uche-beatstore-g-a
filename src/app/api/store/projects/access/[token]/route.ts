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
  'audio_url', 'wav_url', 'peaks_url', 'cover_url',
  'duration_seconds', 'bpm', 'key', 'scale',
].join(', ');

/**
 * GET /api/store/projects/access/[token]
 *
 * Token-gated public endpoint for project bundle buyers. Resolves a
 * project_access_links row, then returns the project + full track list.
 * Download links are token-gated API URLs; raw storage URLs are never returned.
 *
 * 404 covers both "token unknown" and "token expired" so we don't leak
 * which case applies.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const admin = createServiceClient();

    const { data: access, error: aErr } = await admin
      .from('project_access_links')
      .select('id, project_id, buyer_email, expires_at, created_at')
      .eq('token', token)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (access.expires_at && new Date(access.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: project, error: pErr } = await admin
      .from('projects')
      .select('id, user_id, name, cover_url, description, price_usd')
      .eq('id', access.project_id)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const sellerId = (project as any).user_id as string | undefined;

    const junctionRes = await admin
      .from('project_tracks')
      .select('track_id, position')
      .eq('project_id', access.project_id)
      .order('position', { ascending: true });

    const junction = (junctionRes.data ?? []) as Array<{ track_id: string; position: number | null }>;
    const trackIds = junction.map((j) => j.track_id);

    const trackMap: Record<string, any> = {};
    if (trackIds.length > 0) {
      const { data: rows } = await admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .in('id', trackIds);
      for (const t of (rows ?? []) as any[]) {
        trackMap[t.id] = {
          ...t,
          cover_url: sanitizeUrl(t.cover_url),
          audio_url: t.audio_url
            ? `/api/store/projects/access/${encodeURIComponent(token)}/download?track_id=${encodeURIComponent(t.id)}&format=mp3`
            : null,
          wav_url: t.wav_url
            ? `/api/store/projects/access/${encodeURIComponent(token)}/download?track_id=${encodeURIComponent(t.id)}&format=wav`
            : null,
          tags: [],
        };
      }

      // Attach genre/mood tags so the listening page can render
      // hashtag chips next to each track.
      const { data: tagRows } = await admin
        .from('track_tags')
        .select('track_id, tag, category')
        .in('track_id', trackIds);
      for (const r of (tagRows ?? []) as any[]) {
        if (trackMap[r.track_id]) trackMap[r.track_id].tags.push({ tag: r.tag, category: r.category });
      }
    }

    const tracks = junction.map((j) => trackMap[j.track_id]).filter(Boolean);

    let creator: Record<string, unknown> | null = null;
    if (sellerId) {
      const { data: prof } = await admin
        .from('creator_profiles')
        .select('display_name, hero_image_url, contact_email, instagram_handle, twitter_handle, website_url, accent_color, bio')
        .eq('user_id', sellerId)
        .maybeSingle();
      creator = (prof as Record<string, unknown> | null) ?? null;
      if (creator && (creator as any).hero_image_url) {
        creator = { ...creator, hero_image_url: sanitizeUrl((creator as any).hero_image_url) };
      }
    }

    const { user_id: _u, ...safeProject } = project as any;

    return NextResponse.json({
      project: { ...safeProject, cover_url: sanitizeUrl(safeProject.cover_url) },
      tracks,
      creator,
      // buyer_email intentionally NOT returned. The token IS the
      // auth, so anyone holding the URL would see the original
      // buyer's address. Page reads `access.granted_at` only.
      access: {
        granted_at: access.created_at,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
