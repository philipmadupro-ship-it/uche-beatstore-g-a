/**
 * Server-side loader for one artist's workspace: every row the workspace,
 * the timeline and the Notify count read, fetched once, owner-filtered, in
 * parallel. The pure modules (relationship, track-engagement, new-items)
 * decide what the rows MEAN; this only fetches them.
 *
 * Every query filters by the owner explicitly: these run on the service-role
 * client, which bypasses RLS.
 *
 * Unapplied migrations (122–126): the first query against a new table fails
 * with "relation does not exist" / "not in the schema cache". That is reported
 * as `schemaReady: false` and the page stays the plain CRM view, instead of a
 * 500 — the store_layout lesson in CLAUDE.md.
 */

import { selectIn } from '@/lib/db/chunked-in';
import type { Decision, DecisionSetBy } from '@/lib/contacts/decisions';
import { isDecision, MOVING_DECISIONS } from '@/lib/contacts/decisions';
import {
  engagementByTrack,
  signalsFromActivity,
  signalsFromPortal,
  signalsFromSends,
  EMPTY_ENGAGEMENT,
  type TrackEngagement,
} from '@/lib/contacts/track-engagement';
import { deriveRelationshipStage, isWorkspaceMode, type Relationship } from '@/lib/contacts/relationship';
import { availableAt, countUnnotified, isNewSince, type NotifyCount } from '@/lib/artist-portal/new-items';
import { assetAvailableAt } from '@/lib/projects/assets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** PostgREST / Postgres codes for a table or column that does not exist yet. */
export function isMissingSchema(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code && ['42P01', '42703', 'PGRST205', 'PGRST204', 'PGRST200'].includes(e.code)) return true;
  return typeof e.message === 'string' && /does not exist|schema cache/i.test(e.message);
}

export class SchemaNotReadyError extends Error {
  constructor(public readonly cause: unknown) {
    super('Artist workspace tables are missing — apply migrations 122–126');
  }
}

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingSchema(error)) throw new SchemaNotReadyError(error);
    throw error;
  }
  return data ?? [];
}

export interface ProjectLinkRow {
  project_id: string;
  role: string;
  in_portal: boolean;
  allow_downloads: boolean;
  can_comment: boolean;
  last_notified_at: string | null;
  created_at: string;
}

export interface PortalRow {
  id: string;
  /** Mig 129; false when the column is missing. */
  auto_digest?: boolean;
  token: string;
  password_hash: string | null;
  revoked_at: string | null;
  last_viewed_at: string | null;
  previous_viewed_at: string | null;
  view_count: number;
  created_at: string;
}

export interface WorkspaceTrackRow {
  id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  beat_track_id: string | null;
  created_at: string | null;
}

const TRACK_COLUMNS = 'id, title, type, status, bpm, key, scale, cover_url, duration_seconds, beat_track_id, created_at';

export interface ArtistLinks {
  links: ProjectLinkRow[];
  portal: PortalRow | null;
}

/** The two facts that decide workspace mode. Throws SchemaNotReadyError before 122/125. */
export async function loadArtistLinks(admin: Admin, userId: string, contactId: string): Promise<ArtistLinks> {
  const [links, portals] = await Promise.all([
    rows<ProjectLinkRow>(admin
      .from('project_contacts')
      .select('project_id, role, in_portal, allow_downloads, can_comment, last_notified_at, created_at')
      .eq('contact_id', contactId)
      .eq('user_id', userId)),
    rows<PortalRow>(admin
      .from('artist_portals')
      .select('id, token, password_hash, revoked_at, last_viewed_at, previous_viewed_at, view_count, created_at')
      .eq('contact_id', contactId)
      .eq('user_id', userId)),
  ]);
  const portal = portals[0] ?? null;
  if (portal) {
    // Its own query: before migration 129 the column is missing, and that
    // must not cost the producer the whole workspace (the store_layout lesson).
    const { data, error } = await admin.from('artist_portals').select('auto_digest').eq('id', portal.id).eq('user_id', userId).maybeSingle();
    portal.auto_digest = !error && !!(data as { auto_digest?: boolean } | null)?.auto_digest;
  }
  return { links, portal };
}

export interface WorkspaceBeat {
  track: WorkspaceTrackRow;
  projects: Array<{ id: string; name: string }>;
  decision: Decision | null;
  decisionSetBy: DecisionSetBy | null;
  decisionUpdatedAt: string | null;
  engagement: TrackEngagement;
  inPortal: boolean;
  isNewForArtist: boolean;
}

export interface WorkspaceSong {
  track: WorkspaceTrackRow;
  beat: { id: string; title: string } | null;
  projects: Array<{ id: string; name: string }>;
  credited: boolean;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  cover_url: string | null;
  status: string | null;
  description: string | null;
  link: ProjectLinkRow;
  trackCount: number;
  beats: number;
  songs: number;
  /** Tracks the artist has not seen: visible after their previous portal visit. */
  newForArtist: number;
}

export interface WorkspaceFile {
  id: string;
  projectId: string;
  projectName: string;
  kind: string;
  label: string;
  file_name: string;
  mime: string | null;
  size_bytes: number | null;
  in_portal: boolean;
  created_at: string;
  /** In the portal and put there after the artist last looked. */
  isNewForArtist: boolean;
  /** When this artist last downloaded it from the portal. */
  downloadedAt: string | null;
  downloadUrl: string;
}

export interface WorkspaceTrackFile {
  trackId: string;
  title: string;
  type: string | null;
  hasWav: boolean;
  stems: number;
  inPortal: boolean;
  downloads: number;
}

export interface WorkspaceTotals {
  /** Portal plays across every beat and song (last 90 days). */
  plays: number;
  /** Portal downloads: tracks and project files (last 90 days). */
  downloads: number;
  portalVisits: number;
}

export interface Workspace {
  workspaceMode: boolean;
  relationship: Relationship;
  portal: (Omit<PortalRow, 'password_hash'> & { hasPassword: boolean }) | null;
  notify: NotifyCount;
  projects: WorkspaceProject[];
  beats: WorkspaceBeat[];
  songs: WorkspaceSong[];
  files: WorkspaceFile[];
  trackFiles: WorkspaceTrackFile[];
  totals: WorkspaceTotals;
  /** False before migration 127: the Files tab says so instead of looking empty. */
  filesReady: boolean;
  counts: { interested: number; selected: number; recording: number; recorded: number; released: number; passed: number; moving: number };
}

interface ProjectRow { id: string; name: string | null; cover_url: string | null; status: string | null; description: string | null }
interface ProjectTrackRow { project_id: string; track_id: string; added_at: string }
interface StateRow { track_id: string; project_id: string | null; decision: string | null; set_by: string; updated_at: string }
interface SendRow { id: string; track_ids: string[] | null; sent_at: string | null; opened_at: string | null; link_clicked_at: string | null }
interface ActivityRow { kind: string; occurred_at: string; metadata: Record<string, unknown> | null }
interface CreditRow { track_id: string }
interface AssetRow { id: string; project_id: string; kind: string; label: string; file_name: string; mime: string | null; size_bytes: number | null; position: number; in_portal: boolean; portal_at: string | null; created_at: string }
interface StemRow { track_id: string }
interface TrackFileRow { id: string; wav_url: string | null }

/** Engagement is capped to recent history so an old catalogue stays cheap. */
const ENGAGEMENT_WINDOW_DAYS = 90;

export async function loadWorkspace(
  admin: Admin,
  userId: string,
  contact: { id: string; crm_status?: string | null },
  now: Date = new Date(),
): Promise<Workspace> {
  const { links, portal } = await loadArtistLinks(admin, userId, contact.id);
  const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * 86_400_000).toISOString();
  const projectIds = links.map((l) => l.project_id);

  const [projects, projectTracks, states, sends, activity, credits, shareCount] = await Promise.all([
    projectIds.length
      ? selectIn<ProjectRow>((ids) => admin.from('projects').select('id, name, cover_url, status, description').in('id', ids).eq('user_id', userId), projectIds)
      : Promise.resolve([] as ProjectRow[]),
    projectIds.length
      ? selectIn<ProjectTrackRow>((ids) => admin.from('project_tracks').select('project_id, track_id, added_at').in('project_id', ids), projectIds)
      : Promise.resolve([] as ProjectTrackRow[]),
    rows<StateRow>(admin.from('contact_track_states').select('track_id, project_id, decision, set_by, updated_at').eq('contact_id', contact.id).eq('user_id', userId)),
    rows<SendRow>(admin.from('beat_sends').select('id, track_ids, sent_at, opened_at, link_clicked_at').eq('contact_id', contact.id).order('sent_at', { ascending: false }).limit(200)),
    rows<ActivityRow>(admin.from('contact_activity').select('kind, occurred_at, metadata').eq('contact_id', contact.id).eq('user_id', userId)
      .in('kind', ['portal_opened', 'track_played', 'track_downloaded', 'file_downloaded']).gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(1000)),
    rows<CreditRow>(admin.from('track_collaborators').select('track_id').eq('contact_id', contact.id)),
    admin.from('project_shares').select('id', { count: 'exact', head: true }).eq('contact_id', contact.id)
      .then((r: { count: number | null; error: unknown }) => {
        if (r.error && isMissingSchema(r.error)) throw new SchemaNotReadyError(r.error);
        return r.count ?? 0;
      }),
  ]);

  // Project files: their own tolerant query, so a database without 127 keeps
  // the rest of the workspace.
  let filesReady = true;
  const assets: AssetRow[] = projectIds.length
    ? await selectIn<AssetRow>((ids) => admin.from('project_assets')
        .select('id, project_id, kind, label, file_name, mime, size_bytes, position, in_portal, portal_at, created_at')
        .in('project_id', ids).eq('user_id', userId).order('position', { ascending: true }), projectIds)
        .catch((e: unknown) => { if (isMissingSchema(e)) { filesReady = false; return []; } throw e; })
    : [];

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const linkById = new Map(links.map((l) => [l.project_id, l]));

  // Every track this artist is connected to, by any route.
  const trackIds = new Set<string>();
  projectTracks.forEach((pt) => trackIds.add(pt.track_id));
  states.forEach((s) => trackIds.add(s.track_id));
  sends.forEach((s) => (s.track_ids ?? []).forEach((t) => trackIds.add(t)));
  credits.forEach((c) => trackIds.add(c.track_id));

  const tracks = trackIds.size
    ? await selectIn<WorkspaceTrackRow>((ids) => admin.from('tracks').select(TRACK_COLUMNS).in('id', ids).eq('user_id', userId), [...trackIds])
        .catch((e: unknown) => { if (isMissingSchema(e)) throw new SchemaNotReadyError(e); throw e; })
    : [];
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const trackIdList = tracks.map((t) => t.id);
  const [wavRows, stemRows] = trackIdList.length
    ? await Promise.all([
        selectIn<TrackFileRow>((ids) => admin.from('tracks').select('id, wav_url').in('id', ids).eq('user_id', userId), trackIdList),
        selectIn<StemRow>((ids) => admin.from('track_stem_files').select('track_id').in('track_id', ids).eq('user_id', userId), trackIdList)
          .catch(() => [] as StemRow[]),
      ])
    : [[] as TrackFileRow[], [] as StemRow[]];
  const hasWav = new Set(wavRows.filter((r) => !!r.wav_url).map((r) => r.id));
  const stemCount = new Map<string, number>();
  for (const r of stemRows) stemCount.set(r.track_id, (stemCount.get(r.track_id) ?? 0) + 1);

  // Songs point at beats that may live outside this workspace; fetch those titles too.
  const missingBeatIds = tracks
    .map((t) => t.beat_track_id)
    .filter((id): id is string => !!id && !trackById.has(id));
  const extraBeats = missingBeatIds.length
    ? await selectIn<{ id: string; title: string | null }>((ids) => admin.from('tracks').select('id, title').in('id', ids).eq('user_id', userId), missingBeatIds)
    : [];
  const titleOf = (id: string) => trackById.get(id)?.title ?? extraBeats.find((b) => b.id === id)?.title ?? 'Untitled';

  // Projects each track arrived through.
  const projectsOfTrack = new Map<string, Array<{ id: string; name: string }>>();
  for (const pt of projectTracks) {
    const p = projectById.get(pt.project_id);
    if (!p) continue;
    const list = projectsOfTrack.get(pt.track_id) ?? [];
    if (!list.some((x) => x.id === p.id)) list.push({ id: p.id, name: p.name ?? 'Untitled project' });
    projectsOfTrack.set(pt.track_id, list);
  }

  // Engagement.
  const portalVisits = activity.filter((a) => a.kind === 'portal_opened').map((a) => a.occurred_at);
  const placements = projectTracks
    .filter((pt) => linkById.get(pt.project_id)?.in_portal)
    .map((pt) => {
      const link = linkById.get(pt.project_id)!;
      return {
        trackId: pt.track_id,
        availableAt: availableAt(
          { projectId: pt.project_id, trackId: pt.track_id, addedAt: pt.added_at },
          { projectId: link.project_id, linkedAt: link.created_at, lastNotifiedAt: link.last_notified_at },
        ),
      };
    });
  const engagement = engagementByTrack([
    ...signalsFromSends(sends.filter((s) => (s.sent_at ?? '') >= since)),
    ...signalsFromPortal(placements, portalVisits),
    ...signalsFromActivity(activity),
  ]);

  const stateByTrack = new Map(states.map((s) => [s.track_id, s]));
  const portalTrackIds = new Set(placements.map((p) => p.trackId));
  const firstSeenPortal = new Map<string, string>();
  for (const p of placements) {
    const cur = firstSeenPortal.get(p.trackId);
    if (!cur || p.availableAt < cur) firstSeenPortal.set(p.trackId, p.availableAt);
  }
  const creditedIds = new Set(credits.map((c) => c.track_id));

  const beats: WorkspaceBeat[] = [];
  const songs: WorkspaceSong[] = [];
  for (const t of tracks) {
    const projectsForTrack = projectsOfTrack.get(t.id) ?? [];
    if (t.type === 'song') {
      songs.push({
        track: t,
        beat: t.beat_track_id ? { id: t.beat_track_id, title: titleOf(t.beat_track_id) } : null,
        projects: projectsForTrack,
        credited: creditedIds.has(t.id),
      });
      continue;
    }
    const st = stateByTrack.get(t.id);
    const decision = st && isDecision(st.decision) ? st.decision : null;
    const seenAt = firstSeenPortal.get(t.id);
    beats.push({
      track: t,
      projects: projectsForTrack,
      decision,
      decisionSetBy: decision ? (st!.set_by === 'artist' ? 'artist' : 'producer') : null,
      decisionUpdatedAt: st?.updated_at ?? null,
      engagement: engagement.get(t.id) ?? { ...EMPTY_ENGAGEMENT },
      inPortal: portalTrackIds.has(t.id),
      // Visible in the portal after the artist last looked (never looked = unseen).
      isNewForArtist: !!seenAt && isNewSince(seenAt, portal?.last_viewed_at),
    });
  }
  beats.sort((a, b) => (b.decisionUpdatedAt ?? b.track.created_at ?? '').localeCompare(a.decisionUpdatedAt ?? a.track.created_at ?? ''));

  const workspaceProjects: WorkspaceProject[] = links
    .map((link) => {
      const p = projectById.get(link.project_id);
      if (!p) return null;
      const ptRows = projectTracks.filter((pt) => pt.project_id === link.project_id);
      const typed = ptRows.map((pt) => trackById.get(pt.track_id)).filter(Boolean) as WorkspaceTrackRow[];
      const newForArtist = link.in_portal
        ? ptRows.filter((pt) => isNewSince(availableAt(
            { projectId: pt.project_id, trackId: pt.track_id, addedAt: pt.added_at },
            { projectId: link.project_id, linkedAt: link.created_at, lastNotifiedAt: link.last_notified_at },
          ), portal?.last_viewed_at)).length
        : 0;
      return {
        id: p.id,
        name: p.name ?? 'Untitled project',
        cover_url: p.cover_url,
        status: p.status,
        description: p.description,
        link,
        trackCount: ptRows.length,
        beats: typed.filter((t) => t.type !== 'song').length,
        songs: typed.filter((t) => t.type === 'song').length,
        newForArtist,
      };
    })
    .filter((p): p is WorkspaceProject => p !== null)
    .sort((a, b) => b.link.created_at.localeCompare(a.link.created_at));

  // Archived projects leave the portal (membership.ts), so they are not news either.
  const portalLinks = links.filter((l) => l.in_portal && projectById.get(l.project_id)?.status !== 'archived');
  const portalAssets = assets.filter((a) => a.in_portal && portalLinks.some((l) => l.project_id === a.project_id));
  const notify = countUnnotified(
    portalLinks.map((l) => ({ projectId: l.project_id, linkedAt: l.created_at, lastNotifiedAt: l.last_notified_at })),
    projectTracks
      .filter((pt) => portalLinks.some((l) => l.project_id === pt.project_id))
      .map((pt) => ({ projectId: pt.project_id, trackId: pt.track_id, addedAt: pt.added_at })),
    portalAssets.map((a) => ({ projectId: a.project_id, fileId: a.id, portalAt: a.portal_at ?? a.created_at })),
  );

  const fileDownloads = new Map<string, string>();
  for (const a of activity) {
    if (a.kind !== 'file_downloaded') continue;
    const assetId = typeof a.metadata?.asset_id === 'string' ? a.metadata.asset_id : null;
    if (assetId && (!fileDownloads.has(assetId) || a.occurred_at > fileDownloads.get(assetId)!)) fileDownloads.set(assetId, a.occurred_at);
  }
  const files: WorkspaceFile[] = assets
    .filter((a) => projectById.has(a.project_id))
    .map((a) => {
      const link = linkById.get(a.project_id);
      const visibleAt = link ? assetAvailableAt(a, link.created_at) : a.created_at;
      return {
        id: a.id,
        projectId: a.project_id,
        projectName: projectById.get(a.project_id)?.name ?? 'Untitled project',
        kind: a.kind,
        label: a.label,
        file_name: a.file_name,
        mime: a.mime,
        size_bytes: a.size_bytes == null ? null : Number(a.size_bytes),
        in_portal: a.in_portal,
        created_at: a.created_at,
        isNewForArtist: a.in_portal && !!link?.in_portal && isNewSince(visibleAt, portal?.last_viewed_at),
        downloadedAt: fileDownloads.get(a.id) ?? null,
        downloadUrl: `/api/projects/${a.project_id}/assets/${a.id}/download`,
      };
    });

  const trackFiles: WorkspaceTrackFile[] = tracks
    .filter((t) => hasWav.has(t.id) || (stemCount.get(t.id) ?? 0) > 0)
    .map((t) => ({
      trackId: t.id,
      title: t.title ?? 'Untitled',
      type: t.type,
      hasWav: hasWav.has(t.id),
      stems: stemCount.get(t.id) ?? 0,
      inPortal: portalTrackIds.has(t.id),
      downloads: engagement.get(t.id)?.downloads ?? 0,
    }));

  let plays = 0;
  let trackDownloads = 0;
  for (const e of engagement.values()) { plays += e.plays; trackDownloads += e.downloads; }
  const totals: WorkspaceTotals = {
    plays,
    downloads: trackDownloads + activity.filter((a) => a.kind === 'file_downloaded').length,
    portalVisits: portalVisits.length,
  };

  const decisions = states.map((s) => (isDecision(s.decision) ? s.decision : null));
  const counts = { interested: 0, selected: 0, recording: 0, recorded: 0, released: 0, passed: 0, moving: 0 };
  for (const d of decisions) {
    if (!d) continue;
    counts[d] += 1;
    if (MOVING_DECISIONS.includes(d)) counts.moving += 1;
  }

  const relationship = deriveRelationshipStage({
    contacted: sends.length > 0 || !!portal || shareCount > 0,
    engaged: sends.some((s) => s.opened_at || s.link_clicked_at) || portalVisits.length > 0
      || activity.some((a) => a.kind === 'track_played'),
    decisions,
    activeLinkedProjects: workspaceProjects.filter((p) => p.status !== 'archived').length,
    crmStatus: contact.crm_status ?? null,
  });

  const safePortal = portal
    ? (({ password_hash, ...rest }) => ({ ...rest, hasPassword: !!password_hash }))(portal)
    : null;

  return {
    workspaceMode: isWorkspaceMode({ linkedProjects: links.length, hasPortal: !!portal }),
    relationship,
    portal: safePortal,
    notify,
    projects: workspaceProjects,
    beats,
    songs,
    files,
    trackFiles,
    totals,
    filesReady,
    counts,
  };
}
