import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { isSupabaseConfigured, getAll, query } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { signedSharePeaksUrl, signedSharePreviewUrl } from '@/lib/share-media-token';
import { cdnAudioSrc } from '@/lib/audio/cdn';
import { loadPublicArtworkTheme } from '@/lib/artwork/public-theme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ShareContentType = 'project' | 'playlist' | 'track';
type ShareRole = 'viewer' | 'commenter' | 'editor' | string;
type RecipientKind = 'client' | 'producer' | 'rapper' | 'friend' | string;

interface ProjectShareRow {
  id: string;
  project_id?: string | null;
  playlist_id?: string | null;
  track_id?: string | null;
  token: string;
  role: ShareRole;
  allow_downloads: boolean;
  revoked_at?: string | null;
  expires_at?: string | null;
  password_hash?: string | null;
  invited_email?: string | null;
  label?: string | null;
  plays?: number | null;
  created_at?: string | null;
  recipient_kind?: RecipientKind | null;
  sales_enabled?: boolean | null;
  content_type?: ShareContentType | null;
}

interface ProjectAccessRow {
  id: string;
  project_id: string;
  buyer_email?: string | null;
  token: string;
  created_at?: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  cover_url?: string | null;
  description?: string | null;
  bpm_target?: number | null;
  key_target?: string | null;
  status?: string | null;
  user_id?: string | null;
}

interface PlaylistRow {
  id: string;
  name: string;
  cover_url?: string | null;
  user_id?: string | null;
}

interface TrackRow {
  id: string;
  title: string;
  type?: string | null;
  user_id?: string | null;
  audio_url?: string | null;
  preview_url?: string | null;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  lyrics?: string | null;
  description?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
}

interface TrackJunctionRow {
  track_id: string;
  role?: string | null;
  position?: number | null;
}

interface StemRow {
  track_id: string;
  status?: string | null;
  vocals_url?: string | null;
  drums_url?: string | null;
  bass_url?: string | null;
  other_url?: string | null;
}

interface LicenseRow {
  id: string;
  name: string;
  description?: string | null;
  price_usd?: number | null;
  is_free?: boolean | null;
  file_types?: string[] | null;
  stems_included?: boolean | null;
  is_exclusive?: boolean | null;
  sort_order?: number | null;
}

interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  credits?: string | null;
  license_lease_price_usd?: number | null;
  license_exclusive_price_usd?: number | null;
  license_notes?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
}

interface EditableProjectPatch {
  description?: string | null;
  name?: string;
  updated_at?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected server error';
}

/**
 * Public reader for project shares.
 *
 *   GET /api/projects/share/[token]
 *     headers: x-share-password (optional)
 *
 * Returns the project + its track set + the role granted by the link.
 * Owner identity is never leaked; we only echo what the recipient already
 * had to know (project title, tracks they were sent).
 *
 * Role gates the rest of the API:
 *   - viewer    → can read this endpoint and stream audio
 *   - commenter → +POST comments
 *   - editor    → +(reserved for future write flows)
 *
 * `allow_downloads` is independent of role — an editor without downloads
 * still can't pull files; a viewer with downloads can.
 *
 * 401 with `requiresPassword: true` if a password is set and missing/wrong.
 * 410 if expired or revoked.
 * 404 if token is unknown.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const submittedPassword = req.headers.get('x-share-password') ?? '';

  try {
    if (!isSupabaseConfigured()) {
      const share = getAll<ProjectShareRow>('project_shares').find((s) => s.token === token);
      if (!share) return NextResponse.json({ error: 'Link not found' }, { status: 404 });
      if (!share.project_id) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      const tracks = resolveLocalTracks(share.project_id).map((track) => publicShareTrack(track, token));
      return NextResponse.json({
        share: redactShare(share),
        project: resolveLocalProject(share.project_id),
        tracks,
        stems: [],
      });
    }

    const admin = createServiceClient();
    const { data: dbShare, error } = await admin
      .from('project_shares')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;

    let share = dbShare as ProjectShareRow | null;
    if (!share) {
      // Fallback for paid storefront project purchases (migration 042)
      const { data: paidAccess } = await admin
        .from('project_access_links')
        .select('id, project_id, buyer_email, token, created_at')
        .eq('token', token)
        .maybeSingle();
      if (paidAccess) {
        const access = paidAccess as ProjectAccessRow;
        share = {
          id: access.id,
          project_id: access.project_id,
          token: access.token,
          role: 'viewer',
          allow_downloads: true,
          revoked_at: null,
          expires_at: null,
          password_hash: null,
          invited_email: access.buyer_email,
          label: 'Storefront purchase',
          plays: 0,
          created_at: access.created_at,
          recipient_kind: 'client',
          sales_enabled: false,
          content_type: 'project',
        };
      }
    }
    if (!share) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

    if (share.revoked_at) {
      return NextResponse.json({ error: 'This link has been revoked.' }, { status: 410 });
    }
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'This link has expired.' }, { status: 410 });
    }

    if (share.password_hash) {
      if (!submittedPassword) {
        return NextResponse.json({ requiresPassword: true }, { status: 401 });
      }
      const ok = await bcrypt.compare(submittedPassword, share.password_hash);
      if (!ok) {
        return NextResponse.json({ requiresPassword: true, error: 'Incorrect password' }, { status: 401 });
      }
    }

    const CREATOR_FIELDS = 'display_name, bio, hero_image_url, credits, license_lease_price_usd, license_exclusive_price_usd, license_notes, instagram_handle, twitter_handle, spotify_url, soundcloud_url, website_url, contact_email';
    const TRACK_FIELDS = 'id, title, type, audio_url, preview_url, peaks_url, cover_url, duration_seconds, bpm, key, scale, lyrics, description, lease_price_usd, exclusive_price_usd';

    async function fetchCreator(userId: string) {
      const { data } = await admin.from('creator_profiles').select(CREATOR_FIELDS).eq('user_id', userId).maybeSingle();
      return (data as CreatorProfile | null) ?? null;
    }

    // Fire-and-forget play counter (only for real project_shares rows, not paid access tokens)
    if (dbShare && share.id === dbShare.id) {
      admin.from('project_shares').update({ plays: (share.plays ?? 0) + 1 }).eq('id', share.id).then(() => {});
    }

    const contentType = share.content_type ?? 'project';

    // ── Playlist share ──────────────────────────────────────────────────
    if (contentType === 'playlist') {
      const playlistId = share.playlist_id;
      const [{ data: playlist }, { data: junction }] = await Promise.all([
        admin.from('playlists').select('id, name, cover_url, user_id').eq('id', playlistId).maybeSingle(),
        admin.from('playlist_tracks').select('track_id, position').eq('playlist_id', playlistId).order('position', { ascending: true }),
      ]);
      const playlistRow = playlist as PlaylistRow | null;
      const junctionRows = (junction ?? []) as TrackJunctionRow[];
      const trackIds = junctionRows.map((j) => j.track_id);
      let tracks: ReturnType<typeof publicShareTrack>[] = [];
      let stems: ReturnType<typeof redactStems> = [];
      if (trackIds.length) {
        const [tracksRes, stemsRes] = await Promise.all([
          admin.from('tracks').select(TRACK_FIELDS).in('id', trackIds),
          admin.from('stems').select('track_id, status, vocals_url, drums_url, bass_url, other_url').in('track_id', trackIds),
        ]);
        stems = redactStems(stemsRes.data as StemRow[] | null, share.allow_downloads);
        const byId = new Map(((tracksRes.data ?? []) as TrackRow[]).map((t) => [t.id, t]));
        tracks = junctionRows
          .map((j) => byId.get(j.track_id))
          .filter((track): track is TrackRow => Boolean(track))
          .map((track) => publicShareTrack(track, token));
      }
      const creator = playlistRow?.user_id ? await fetchCreator(playlistRow.user_id) : null;
      const playlistPublic = redactUserId(playlistRow);
      return NextResponse.json({
        share: redactShare(share),
        playlist: playlistPublic,
        project: null,
        tracks,
        creator,
        stems,
        // Recipients of a share link have no session either, so the artwork
        // they see comes with the payload like it does on the storefront.
        artworkTheme: await loadPublicArtworkTheme(admin, playlistRow?.user_id),
      });
    }

    // ── Single-track share ──────────────────────────────────────────────
    if (contentType === 'track') {
      const trackId = share.track_id;
      const { data: trackRow } = await admin.from('tracks').select(`${TRACK_FIELDS}, user_id`).eq('id', trackId).maybeSingle();
      const track = trackRow as TrackRow | null;
      const tracks = track ? [publicShareTrack(track, token)] : [];
      const stems = track
        ? redactStems((await admin.from('stems').select('track_id, status, vocals_url, drums_url, bass_url, other_url').eq('track_id', trackId)).data, share.allow_downloads)
        : [];
      const creator = track?.user_id ? await fetchCreator(track.user_id) : null;
      const trackPublic = track ? { id: track.id, title: track.title, cover_url: track.cover_url } : null;
      return NextResponse.json({
        share: redactShare(share),
        track: trackPublic,
        project: null,
        playlist: null,
        tracks,
        creator,
        stems,
        artworkTheme: await loadPublicArtworkTheme(admin, track?.user_id),
      });
    }

    // ── Project share (default) ─────────────────────────────────────────
    // Project + junction don't depend on each other; fan out.
    const [{ data: project }, { data: junction }] = await Promise.all([
      admin.from('projects')
        .select('id, name, cover_url, description, bpm_target, key_target, status, user_id')
        .eq('id', share.project_id)
        .maybeSingle(),
      admin.from('project_tracks')
        .select('track_id, role, position')
        .eq('project_id', share.project_id)
        .order('position', { ascending: true }),
    ]);
    const projectRow = project as ProjectRow | null;
    const junctionRows = (junction ?? []) as TrackJunctionRow[];

    const trackIds = junctionRows.map((j) => j.track_id);

    // Creator depends on project.user_id; tracks/stems depend on junction.
    // Run all three in parallel now that those inputs are resolved.
    const [creator, tracksRes, stemsRes] = await Promise.all([
      projectRow?.user_id ? fetchCreator(projectRow.user_id) : Promise.resolve(null),
      trackIds.length ? admin.from('tracks').select(TRACK_FIELDS).in('id', trackIds) : Promise.resolve({ data: [] as TrackRow[] }),
      trackIds.length ? admin.from('stems').select('track_id, status, vocals_url, drums_url, bass_url, other_url').in('track_id', trackIds) : Promise.resolve({ data: [] as StemRow[] }),
    ]);

    const stems = redactStems(stemsRes.data as StemRow[] | null, share.allow_downloads);
    const byId = new Map(((tracksRes.data ?? []) as TrackRow[]).map((t) => [t.id, t]));
    const tracks = trackIds.length
      ? junctionRows.map((j) => byId.get(j.track_id)).filter((track): track is TrackRow => Boolean(track))
      : [];
    const safeTracks = tracks.map((track) => publicShareTrack(track, token));

    const projectPublic = redactUserId(projectRow);

    // ── Producer's custom license tiers (for client share page) ────────
    let licenses: LicenseRow[] = [];
    if (projectRow?.user_id) {
      try {
        const { data: licData } = await admin
          .from('licenses')
          .select('id, name, description, price_usd, is_free, file_types, stems_included, is_exclusive, sort_order')
          .eq('user_id', projectRow.user_id)
          .order('sort_order', { ascending: true });
        licenses = (licData as LicenseRow[] | null) ?? [];
      } catch {
        // licenses table may not exist in all deployments — non-fatal
      }
    }

    return NextResponse.json({
      share: redactShare(share),
      project: projectPublic,
      playlist: null,
      track: null,
      tracks: safeTracks,
      creator,
      stems,
      licenses,
      artworkTheme: await loadPublicArtworkTheme(admin, projectRow?.user_id),
    });
  } catch (error: unknown) {
    console.error('Project share read error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * PATCH /api/projects/share/[token]
 *   body: { description?: string, name?: string }
 *   headers: x-share-password (if locked)
 *
 * Editor-role token holders can edit a small whitelist of project fields.
 * Viewer and commenter return 403. The whitelist is intentionally tight —
 * destructive operations (delete, transfer, change owner) stay owner-only.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const submittedPassword = req.headers.get('x-share-password') ?? '';

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Edit flow requires Supabase' }, { status: 501 });
    }

    const admin = createServiceClient();
    const { data: share, error: sErr } = await admin
      .from('project_shares')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!share) return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    if (share.revoked_at) return NextResponse.json({ error: 'Link revoked' }, { status: 410 });
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }
    if (share.password_hash) {
      if (!submittedPassword) return NextResponse.json({ requiresPassword: true }, { status: 401 });
      const ok = await bcrypt.compare(submittedPassword, share.password_hash);
      if (!ok) return NextResponse.json({ requiresPassword: true, error: 'Bad password' }, { status: 401 });
    }
    if (share.role !== 'editor') {
      return NextResponse.json(
        { error: 'This link does not grant edit access.' },
        { status: 403 },
      );
    }

    // Whitelist editable fields. Names like `user_id` / `created_at` are
    // explicitly excluded; we don't trust the share token for ownership
    // changes regardless of role.
    const body = await req.json().catch(() => ({})) as { description?: unknown; name?: unknown };
    const patch: EditableProjectPatch = {};
    if (typeof body.description === 'string') {
      const v = body.description.trim();
      if (v.length > 5000) {
        return NextResponse.json({ error: 'Description too long' }, { status: 400 });
      }
      patch.description = v || null;
    }
    if (typeof body.name === 'string') {
      const v = body.name.trim();
      if (!v || v.length > 200) {
        return NextResponse.json({ error: 'Invalid project name' }, { status: 400 });
      }
      patch.name = v;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from('projects')
      .update(patch)
      .eq('id', share.project_id)
      .select('id, name, cover_url, description, bpm_target, key_target, status')
      .single();
    if (error) throw error;
    return NextResponse.json({ project: data });
  } catch (error: unknown) {
    console.error('Editor PATCH error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

function redactShare(s: ProjectShareRow) {
  // Never echo password_hash or created_by — recipients have no
  // business seeing either. `recipient_kind` drives the share page
  // variant; `sales_enabled` gates whether the license card renders
  // Buy buttons (Stripe Checkout).
  return {
    token: s.token,
    role: s.role,
    allow_downloads: s.allow_downloads,
    expires_at: s.expires_at,
    label: s.label,
    recipient_kind: s.recipient_kind ?? 'client',
    sales_enabled: s.sales_enabled === true,
  };
}

function publicShareTrack(track: TrackRow, token: string) {
  const { user_id: _userId, audio_url: _audioUrl, preview_url, ...rest } = track;
  void _userId;
  void _audioUrl;
  // Stream the public preview clip straight from R2 (fast + edge-cached +
  // prefetchable) when it exists; fall back to the signed proxy for tracks
  // whose preview hasn't been generated yet. The preview is the truncated,
  // public-by-design clip — the full master is never exposed either way.
  const direct = typeof preview_url === 'string' && /^https?:\/\//i.test(preview_url)
    ? cdnAudioSrc(preview_url)
    : null;
  return {
    ...rest,
    preview_url: null,
    audio_url: direct ?? signedSharePreviewUrl(token, track.id),
    peaks_url: track.peaks_url ? signedSharePeaksUrl(token, track.id) : null,
  };
}

function redactStems(stems: StemRow[] | null | undefined, allowDownloads: boolean) {
  if (!allowDownloads) return [];
  return (stems ?? []).map((stem) => ({
    track_id: stem.track_id,
    status: stem.status,
  }));
}

function redactUserId<T extends { user_id?: string | null }>(row: T | null | undefined) {
  if (!row) return null;
  const { user_id: _userId, ...rest } = row;
  void _userId;
  return rest;
}

function resolveLocalProject(projectId: string) {
  const projects = getAll<ProjectRow>('projects');
  return projects.find((p) => p.id === projectId) || null;
}

function resolveLocalTracks(projectId: string) {
  const pt = query<TrackJunctionRow & { project_id: string }>('project_tracks', (j) => j.project_id === projectId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const ids = new Set(pt.map((j) => j.track_id));
  return getAll<TrackRow>('tracks').filter((t) => ids.has(t.id));
}
