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

interface ProjectAccessRow {
  id: string;
  project_id: string;
  buyer_email?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
}

interface ProjectRow {
  id: string;
  user_id?: string | null;
  name: string;
  cover_url?: string | null;
  description?: string | null;
  price_usd?: number | null;
}

interface ProjectTrackRow {
  track_id: string;
  position: number | null;
}

interface AccessTrackRow {
  id: string;
  title?: string | null;
  type?: string | null;
  audio_url?: string | null;
  wav_url?: string | null;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

interface TrackTagRow {
  track_id: string;
  tag: string;
  category: string;
}

interface PublicAccessTrack extends AccessTrackRow {
  audio_url: string | null;
  wav_url: string | null;
  cover_url?: string | null;
  tags: Array<{ tag: string; category: string }>;
}

interface CreatorProfile {
  display_name?: string | null;
  hero_image_url?: string | null;
  contact_email?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  website_url?: string | null;
  accent_color?: string | null;
  bio?: string | null;
}

function stripUserId<T extends { user_id?: string | null }>(row: T): Omit<T, 'user_id'> {
  const { user_id: _userId, ...rest } = row;
  void _userId;
  return rest;
}

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

    const accessRow = access as ProjectAccessRow;
    if (accessRow.expires_at && new Date(accessRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: project, error: pErr } = await admin
      .from('projects')
      .select('id, user_id, name, cover_url, description, price_usd')
      .eq('id', accessRow.project_id)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const projectRow = project as ProjectRow;
    const sellerId = projectRow.user_id ?? undefined;

    const junctionRes = await admin
      .from('project_tracks')
      .select('track_id, position')
      .eq('project_id', accessRow.project_id)
      .order('position', { ascending: true });

    const junction = (junctionRes.data ?? []) as ProjectTrackRow[];
    const trackIds = junction.map((j) => j.track_id);

    const trackMap: Record<string, PublicAccessTrack> = {};
    if (trackIds.length > 0) {
      const { data: rows } = await admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .in('id', trackIds);
      for (const t of (rows ?? []) as unknown as AccessTrackRow[]) {
        trackMap[t.id] = {
          ...t,
          cover_url: sanitizeUrl(t.cover_url),
          audio_url: t.audio_url
            ? `/api/store/projects/access/${encodeURIComponent(token)}/download?track_id=${encodeURIComponent(t.id)}&format=mp3`
            : null,
          wav_url: t.wav_url
            ? `/api/store/projects/access/${encodeURIComponent(token)}/download?track_id=${encodeURIComponent(t.id)}&format=wav`
            : null,
          peaks_url: t.peaks_url
            ? `/api/store/projects/access/${encodeURIComponent(token)}/peaks?track_id=${encodeURIComponent(t.id)}`
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
      for (const r of (tagRows ?? []) as unknown as TrackTagRow[]) {
        if (trackMap[r.track_id]) trackMap[r.track_id].tags.push({ tag: r.tag, category: r.category });
      }
    }

    const tracks = junction.map((j) => trackMap[j.track_id]).filter(Boolean);

    let creator: CreatorProfile | null = null;
    if (sellerId) {
      const { data: prof } = await admin
        .from('creator_profiles')
        .select('display_name, hero_image_url, contact_email, instagram_handle, twitter_handle, website_url, accent_color, bio')
        .eq('user_id', sellerId)
        .maybeSingle();
      creator = (prof as CreatorProfile | null) ?? null;
      if (creator?.hero_image_url) {
        creator = { ...creator, hero_image_url: sanitizeUrl(creator.hero_image_url) };
      }
    }

    const safeProject = stripUserId(projectRow);

    return NextResponse.json({
      project: { ...safeProject, cover_url: sanitizeUrl(safeProject.cover_url) },
      tracks,
      creator,
      // buyer_email intentionally NOT returned. The token IS the
      // auth, so anyone holding the URL would see the original
      // buyer's address. Page reads `access.granted_at` only.
      access: {
        granted_at: accessRow.created_at,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
