import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { signedSharePeaksUrl, signedSharePreviewUrl } from '@/lib/share-media-token';
import { isDecision } from '@/lib/contacts/decisions';
import { gatePortal, hashRequestIp } from '@/lib/artist-portal/gate';
import { portalProjectLinks } from '@/lib/artist-portal/membership';
import { availableAt, isNewSince, nextVisitWatermarks } from '@/lib/artist-portal/new-items';
import { publicUrlOrNull, toPortalArtworkTheme, toPortalFile, toPortalProject, toPortalTrack, type PortalTrack, type PortalView } from '@/lib/artist-portal/view';
import { loadPortalAssets } from '@/lib/artist-portal/files';
import { assetAvailableAt } from '@/lib/projects/assets';
import { isSchemaNotReady } from '@/lib/artists/http';
import { loadPublicArtworkTheme } from '@/lib/artwork/public-theme';
import { loadSongBeats } from '@/lib/tracks/song-beats-store';
import { cleanPitchNote, orderForAudience, portalAudience } from '@/lib/artist-portal/audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal');

interface TrackRow {
  id: string;
  title: string | null;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  beat_track_id: string | null;
  audio_url: string | null;
  wav_url: string | null;
  preview_url: string | null;
  peaks_url: string | null;
  stems_status?: string | null;
  [key: string]: unknown;
}

/**
 * GET /api/portal/[token] — one artist's library.
 *
 * Public by token (allowlisted in lib/security/api-gate.ts), so everything is
 * decided here: the shared share gate (404 / 410 revoked / 401 password), then
 * membership — only projects linked to this contact with `in_portal`, only
 * tracks the producer owns. The JSON is built field by field in
 * lib/artist-portal/view.ts: no private storage reference, no CRM field, no
 * other artist's reaction. Audio goes out as 15-minute signed share-media
 * URLs, served by the existing preview/peaks routes.
 *
 * A visit moves the NEW watermark (lib/artist-portal/new-items) and, once per
 * session, logs `portal_opened` on the contact's timeline.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portal:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;
    const ownerId = portal.user_id;

    const links = await portalProjectLinks(admin, portal);
    const projectIds = links.map((l) => l.project_id);

    const [contactRes, profileRes, projects, projectTracks, statesRes, assets] = await Promise.all([
      admin.from('contacts').select('name, category').eq('id', portal.contact_id).eq('user_id', ownerId).maybeSingle(),
      admin.from('creator_profiles').select('display_name, logo_url, hero_image_url').eq('user_id', ownerId).maybeSingle(),
      projectIds.length
        ? selectIn<{ id: string; name: string | null; cover_url: string | null; description: string | null; status: string | null }>((ids) => admin.from('projects').select('id, name, cover_url, description, status').in('id', ids).eq('user_id', ownerId), projectIds)
        : Promise.resolve([]),
      projectIds.length
        ? selectIn<{ project_id: string; track_id: string; added_at: string; position: number }>((ids) => admin.from('project_tracks').select('project_id, track_id, added_at, position').in('project_id', ids), projectIds)
        : Promise.resolve([]),
      admin.from('contact_track_states').select('track_id, decision, set_by').eq('contact_id', portal.contact_id).eq('user_id', ownerId),
      loadPortalAssets(admin, ownerId, projectIds),
    ]);
    if (statesRes.error) throw statesRes.error;
    // The portal's shape follows the contact's MAIN role (lib/artist-portal/audience).
    const audience = portalAudience((contactRes.data as { category?: string | null } | null)?.category);
    const pitchNotes = audience === 'label' ? await loadPitchNotes(admin, portal, projectIds) : new Map<string, string>();

    const trackIds = [...new Set(projectTracks.map((pt) => pt.track_id))];
    const tracks = trackIds.length
      ? await selectIn<TrackRow>((ids) => admin.from('tracks')
          .select('id, title, type, bpm, key, scale, duration_seconds, cover_url, beat_track_id, audio_url, wav_url, preview_url, peaks_url, stems_status')
          .in('id', ids).eq('user_id', ownerId), trackIds)
      : [];
    const trackById = new Map(tracks.map((t) => [t.id, t]));
    const songBeats = await loadSongBeats(admin, ownerId, tracks.filter((t) => t.type === 'song'));

    // Watermarks: NEW is judged against the visit BEFORE this one.
    const now = new Date().toISOString();
    const marks = nextVisitWatermarks(portal, now);
    const watermark = marks.previous_viewed_at;

    const linkById = new Map(links.map((l) => [l.project_id, l]));
    const liveProjects = projects.filter((p) => p.status !== 'archived');
    const liveIds = new Set(liveProjects.map((p) => p.id));
    const states = new Map(((statesRes.data ?? []) as Array<{ track_id: string; decision: string | null; set_by: string }>)
      .map((s) => [s.track_id, s]));

    // One entry per track, carrying every portal project it is in.
    const entries = new Map<string, { projectIds: string[]; firstSeen: string; canDownload: boolean }>();
    for (const pt of [...projectTracks].sort((a, b) => a.position - b.position)) {
      if (!liveIds.has(pt.project_id) || !trackById.has(pt.track_id)) continue;
      const link = linkById.get(pt.project_id)!;
      const seen = availableAt(
        { projectId: pt.project_id, trackId: pt.track_id, addedAt: pt.added_at },
        { projectId: link.project_id, linkedAt: link.created_at, lastNotifiedAt: link.last_notified_at },
      );
      const cur = entries.get(pt.track_id) ?? { projectIds: [], firstSeen: seen, canDownload: false };
      if (!cur.projectIds.includes(pt.project_id)) cur.projectIds.push(pt.project_id);
      if (seen < cur.firstSeen) cur.firstSeen = seen;
      cur.canDownload = cur.canDownload || link.allow_downloads;
      entries.set(pt.track_id, cur);
    }

    const portalTracks: PortalTrack[] = orderForAudience([...entries.entries()].map(([trackId, e]) => {
      const t = trackById.get(trackId)!;
      const st = states.get(trackId);
      const decision = st && isDecision(st.decision) ? st.decision : null;
      // Only beats that are in this portal are named (main first).
      const builtOn = (songBeats.get(trackId) ?? [])
        .filter((b) => entries.has(b) && trackById.has(b))
        .map((b) => ({ id: b, title: trackById.get(b)!.title ?? 'Untitled' }));
      const hasAudio = !!(t.preview_url || t.audio_url);
      return toPortalTrack(t, {
        projectIds: e.projectIds,
        isNew: isNewSince(e.firstSeen, watermark),
        decision,
        decisionSetBy: decision ? (st!.set_by === 'artist' ? 'artist' : 'producer') : null,
        canDownload: e.canDownload && !!(t.wav_url || t.audio_url),
        builtOn,
        hasStems: t.stems_status === 'done',
        streamUrl: hasAudio ? signedSharePreviewUrl(portal.token, trackId) : null,
        peaksUrl: t.peaks_url ? signedSharePeaksUrl(portal.token, trackId) : null,
      });
    }), audience);

    const portalFiles = assets
      .filter((a) => liveIds.has(a.project_id))
      .map((a) => toPortalFile(a, {
        token: portal.token,
        isNew: isNewSince(assetAvailableAt(a, linkById.get(a.project_id)!.created_at), watermark),
      }));

    const view: PortalView = {
      portal: { artistName: (contactRes.data as { name?: string } | null)?.name ?? '', lastVisitAt: watermark, audience },
      producer: {
        name: (profileRes.data as { display_name?: string | null } | null)?.display_name ?? '',
        logo_url: publicUrlOrNull((profileRes.data as { logo_url?: string | null } | null)?.logo_url),
        avatar_url: publicUrlOrNull((profileRes.data as { hero_image_url?: string | null } | null)?.hero_image_url),
      },
      projects: liveProjects
        .sort((a, b) => (linkById.get(b.id)!.created_at).localeCompare(linkById.get(a.id)!.created_at))
        .map((p) => {
          const inProject = portalTracks.filter((t) => t.projectIds.includes(p.id));
          const link = linkById.get(p.id)!;
          return toPortalProject(p, {
            isNew: isNewSince(link.created_at, watermark),
            newCount: inProject.filter((t) => t.isNew).length + portalFiles.filter((f) => f.projectId === p.id && f.isNew).length,
            beats: inProject.filter((t) => t.type !== 'song').length,
            songs: inProject.filter((t) => t.type === 'song').length,
            files: portalFiles.filter((f) => f.projectId === p.id).length,
            allowDownloads: link.allow_downloads,
            canComment: link.can_comment,
            pitchNote: pitchNotes.get(p.id) ?? null,
          });
        }),
      tracks: portalTracks,
      files: portalFiles,
      artworkTheme: toPortalArtworkTheme(await loadPublicArtworkTheme(admin, ownerId)),
    };

    // Record the visit. Failures here must not cost the artist their page.
    const newCount = portalTracks.filter((t) => t.isNew).length + portalFiles.filter((f) => f.isNew).length;
    const { error: visitErr } = await admin
      .from('artist_portals')
      .update({
        last_viewed_at: marks.last_viewed_at,
        previous_viewed_at: marks.previous_viewed_at,
        view_count: (portal.view_count ?? 0) + (marks.isNewVisit ? 1 : 0),
      })
      .eq('id', portal.id);
    if (visitErr) log.warn('portal visit stamp failed', { error: errorMessage(visitErr) });
    if (marks.isNewVisit) {
      const { error: actErr } = await admin.from('contact_activity').insert({
        contact_id: portal.contact_id,
        user_id: ownerId,
        kind: 'portal_opened',
        title: newCount > 0 ? `Opened the portal · ${newCount} new` : 'Opened the portal',
        metadata: { new_count: newCount, ip_hash: hashRequestIp(req) },
        occurred_at: now,
      });
      if (actErr) log.warn('portal_opened row failed', { error: errorMessage(actErr) });
    }

    return NextResponse.json(view, { headers: { 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    log.error('portal load failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

/**
 * A label's pitch per project (mig 135). Optional: before the migration the
 * column is missing and the portal simply shows no pitch.
 */
async function loadPitchNotes(admin: ReturnType<typeof createServiceClient>, portal: { contact_id: string; user_id: string }, projectIds: string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const { data, error } = await admin
    .from('project_contacts')
    .select('project_id, pitch_note')
    .eq('contact_id', portal.contact_id)
    .eq('user_id', portal.user_id)
    .in('project_id', projectIds);
  if (error) {
    log.warn('pitch notes unavailable', { error: errorMessage(error) });
    return new Map();
  }
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ project_id: string; pitch_note: unknown }>) {
    const note = cleanPitchNote(r.pitch_note);
    if (note) out.set(r.project_id, note);
  }
  return out;
}
