/**
 * The artist ↔ label connection (LABEL-41, D1, D6, 17 R3). Pure: the routes
 * and `lib/auth/org-access` load rows, this module decides.
 *
 * A connection joins one ARTIST org and one LABEL org. The artist side
 * decides what is shared (`share_mode` + the selected projects) and whether
 * the label may copy a recording out (`allow_copies`); the label side sees
 * that music through ONE roster contact (`label_contact_id`), under its own
 * staff permissions and its own artist scope. Nothing is stored on the label
 * side about what the artist org holds: access is derived on every request
 * from the connection row, so ending it (or narrowing the share) takes effect
 * on the next one.
 *
 * Status moves: requested → active | declined | ended; active → ended. Only
 * the side that did NOT ask may accept; either side may end.
 *
 * The SQL twin of `connectionReachesProject` is `can_see_via_connection`
 * (migration 154); the artist-scope half is `can_see_artist`.
 */
import type { Track } from '@/lib/types';
import { scopeAllowsContact, type ArtistScope } from './artist-scope';

export const CONNECTION_STATUSES = ['requested', 'active', 'declined', 'ended'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type ConnectionSide = 'label' | 'artist';
export const SHARE_MODES = ['selected', 'all'] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

/** The capability a connected label member needs on the artist org's music: reading, nothing else. */
export const CONNECTED_CAPABILITY = 'catalog.read' as const;

export type ConnectionRow = {
  id: string;
  label_org_id: string;
  artist_org_id: string;
  status: ConnectionStatus;
  initiated_by: ConnectionSide;
  label_contact_id: string | null;
  share_mode: ShareMode;
  allow_copies: boolean;
  accepted_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export const CONNECTION_COLUMNS =
  'id, label_org_id, artist_org_id, status, initiated_by, label_contact_id, share_mode, allow_copies, accepted_at, ended_at, created_at';

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Which side `orgId` is on, or null when it is neither. */
export function sideOf(conn: Pick<ConnectionRow, 'label_org_id' | 'artist_org_id'>, orgId: string): ConnectionSide | null {
  if (eq(conn.label_org_id, orgId)) return 'label';
  if (eq(conn.artist_org_id, orgId)) return 'artist';
  return null;
}

export function isOpen(conn: Pick<ConnectionRow, 'status'>): boolean {
  return conn.status === 'requested' || conn.status === 'active';
}

/** May `orgId` accept this request? The other side from the one that asked, while it is still a request. */
export function mayAccept(conn: Pick<ConnectionRow, 'status' | 'initiated_by' | 'label_org_id' | 'artist_org_id'>, orgId: string): boolean {
  if (conn.status !== 'requested') return false;
  const side = sideOf(conn, orgId);
  return side !== null && side !== conn.initiated_by;
}

/** Only the ARTIST side changes what is shared. */
export function mayChangeShare(conn: Pick<ConnectionRow, 'status' | 'artist_org_id'>, orgId: string): boolean {
  return isOpen(conn) && eq(conn.artist_org_id, orgId);
}

/**
 * Does an ACTIVE connection reach this project of the artist org? `shared` is
 * the connection's `connection_projects`; the project must already be known
 * to belong to the artist org (the caller read it with that filter).
 */
export function connectionReachesProject(
  conn: Pick<ConnectionRow, 'status' | 'share_mode'>,
  shared: ReadonlySet<string>,
  projectId: string,
): boolean {
  if (conn.status !== 'active') return false;
  if (conn.share_mode === 'all') return true;
  return shared.has(projectId.toLowerCase());
}

/** A track is reached through any project it sits in that the connection reaches. */
export function connectionReachesAnyProject(
  conn: Pick<ConnectionRow, 'status' | 'share_mode'>,
  shared: ReadonlySet<string>,
  projectIds: readonly string[],
): boolean {
  return projectIds.some((id) => connectionReachesProject(conn, shared, id));
}

/**
 * The label member's own artist scope applied to the connection: they reach
 * the artist org's music only if they could open the roster contact that
 * stands for it. An active connection always has one; without it nothing.
 */
export function labelScopeReaches(scope: ArtistScope, conn: Pick<ConnectionRow, 'label_contact_id'>): boolean {
  return scopeAllowsContact(scope, conn.label_contact_id);
}

/** The lower-cased set a share check compares against. */
export function toSharedSet(projectIds: readonly string[]): Set<string> {
  return new Set(projectIds.map((id) => id.toLowerCase()));
}

/** What an org sees of one of ITS connections: the other party, never its internals. */
export type ConnectionView = {
  id: string;
  status: ConnectionStatus;
  /** The side of the org that is asking. */
  side: ConnectionSide;
  initiatedByMe: boolean;
  /** The other org's public identity: its name and slug, nothing more. */
  other: { name: string; slug: string };
  /** The label's roster contact (label side only: the artist org has no use for it). */
  rosterContactId: string | null;
  shareMode: ShareMode;
  allowCopies: boolean;
  /** The artist side's selected project ids; the label side learns the projects it may open from the projects route. */
  projectIds: string[] | null;
  createdAt: string;
  acceptedAt: string | null;
  /** Can the viewer's org accept it now? */
  canAccept: boolean;
};

export function toConnectionView(
  conn: ConnectionRow,
  orgId: string,
  other: { name: string; slug: string },
  projectIds: readonly string[],
): ConnectionView | null {
  const side = sideOf(conn, orgId);
  if (!side) return null;
  return {
    id: conn.id,
    status: conn.status,
    side,
    initiatedByMe: conn.initiated_by === side,
    other: { name: other.name, slug: other.slug },
    rosterContactId: side === 'label' ? conn.label_contact_id : null,
    shareMode: conn.share_mode,
    allowCopies: conn.allow_copies,
    projectIds: side === 'artist' ? [...projectIds].sort() : null,
    createdAt: conn.created_at,
    acceptedAt: conn.accepted_at,
    canAccept: mayAccept(conn, orgId),
  };
}

/** The word on a roster row / connection card. */
export function statusLabel(view: Pick<ConnectionView, 'status' | 'initiatedByMe'>): string {
  switch (view.status) {
    case 'active':
      return 'Connected';
    case 'requested':
      return view.initiatedByMe ? 'Request sent' : 'Wants to connect';
    case 'declined':
      return 'Declined';
    case 'ended':
      return 'Ended';
  }
}

/** A short line saying what the label can reach, for the artist's settings. */
export function shareSummary(shareMode: ShareMode, projectCount: number): string {
  if (shareMode === 'all') return 'Your whole catalogue';
  if (projectCount === 0) return 'Nothing yet';
  return projectCount === 1 ? '1 project' : `${projectCount} projects`;
}

/** Copy provenance (D6): what is stored on a copied recording. No live reference to the source. */
export type Provenance = {
  source_org_id: string | null;
  source_track_id: string;
  copied_at: string;
  copied_by: string;
};

export function buildProvenance(input: { sourceOrgId: string | null; sourceTrackId: string; copiedBy: string; now?: Date }): Provenance {
  return {
    source_org_id: input.sourceOrgId,
    source_track_id: input.sourceTrackId,
    copied_at: (input.now ?? new Date()).toISOString(),
    copied_by: input.copiedBy,
  };
}

/**
 * The columns of a copied recording that come over from its source: its own
 * audio, wav and basic facts. Stems, previews, peaks and links do NOT: the
 * label's processing makes its own private preview and peaks (D8), and a copy
 * is a new recording with no relationship to the source's other material.
 */
/** Beat reuse (D6): material is copied, songs are not (a song is made in the label, built on a copied beat). */
export const COPYABLE_TYPES = ['beat', 'instrumental', 'loop', 'topline'] as const;
export function isCopyableType(type: string | null | undefined): boolean {
  return typeof type === 'string' && (COPYABLE_TYPES as readonly string[]).includes(type);
}

export const COPY_SOURCE_COLUMNS = 'id, title, type, bpm, key, scale, duration_seconds, loudness, audio_url, wav_url';

// ── The shared music, as the label sees it (client-safe shapes) ─────────

export type ConnectedRecording = {
  id: string;
  title: string;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  durationSeconds: number | null;
  /** May this member copy it into their label (the artist allows copies AND the member may write the catalogue)? */
  canCopy: boolean;
};

export type ConnectedProject = {
  id: string;
  name: string;
  isInbox: boolean;
  recordings: ConnectedRecording[];
};

export type ConnectedMusic = {
  connection: { id: string; allowCopies: boolean; shareMode: ShareMode };
  projects: ConnectedProject[];
};

/** The same-origin stream of one connected recording (the audio route resolves the artist org from the row). */
export function connectedAudioUrl(labelOrgId: string, trackId: string): string {
  return `/api/org/${labelOrgId}/audio/${trackId}?variant=full`;
}

/** One connected recording as the persistent PlayerBar plays it (no stored reference ever reaches the client). */
export function connectedRecordingPlayerTrack(labelOrgId: string, rec: ConnectedRecording, projectName: string): Track {
  return {
    id: rec.id,
    user_id: '',
    title: rec.title,
    type: rec.type,
    audio_url: connectedAudioUrl(labelOrgId, rec.id),
    preview_url: null,
    peaks_url: null,
    bands_url: null,
    cover_url: null,
    duration_seconds: rec.durationSeconds,
    bpm: rec.bpm,
    key: rec.key,
    stems_status: 'none',
    created_at: '',
    description: projectName,
  } as unknown as Track;
}
