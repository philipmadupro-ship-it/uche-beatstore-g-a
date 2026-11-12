/**
 * The pure half of the activity feeds (LABEL-20, 08 §B4–B5): what leaves the
 * database as a feed event, and who may see which one. The reads are in
 * activity-store.ts; grouping is digest.ts.
 *
 * VISIBILITY. Decided at write time per verb (`activity.ts#DEFAULT_VISIBILITY`)
 * and applied here on top of the viewer's CURRENT scope (08 §B4: remove
 * someone's access and they lose the history with it). `eventVisibleTo` is the
 * TypeScript twin of the `activity_events_member_read` policy of migration 147
 * (its scope sets: the caller's whole-org memberships, their member_artist_scopes
 * and `labelos_scoped_projects()`), held equal to it by
 * `supabase/local/checks/147_*.sql` and the e2e spec label-org-activity:
 *
 *   catalog.read
 *   AND (visibility = 'artist' OR business.read.internal)
 *   AND ( whole-org member
 *         OR event names an artist  → that artist is in scope
 *         OR event names a project  → that project is in scope
 *         OR                          nothing: organization-level, hidden )
 *
 * An event that names an artist is judged by the artist alone — a visible
 * project does not widen it (a release for Kilo is not Nova's news because
 * both sit in one project). An event naming neither (members, invitations,
 * settings) is the organization's own business, and a scoped member never
 * sees it. A `song_id` alone does not place an event: the song events carry
 * their artist or project (`song.created`, `recording.uploaded`), and a future
 * song-only event stays hidden from scoped members until it names one.
 *
 * Service-role reads bypass RLS, so the routes apply this function themselves.
 * D4 (a member who may not read a song's row does not read its history either)
 * is applied by `withholdHiddenSongs` on top; the policy does not carry it.
 */
import type { ArtistScope } from './artist-scope';
import { scopeAllowsContact } from './artist-scope';
import type { DigestEvent, EventSummary, ReleaseItemsChange } from './digest';
import { isSongStage } from './song-stage';
import { isReviewVerdict } from './song-review';

/** The columns a feed reads from `activity_events`. */
export const ACTIVITY_COLUMNS =
  'id, verb, actor_id, artist_id, project_id, song_id, release_id, subject_type, subject_id, payload, visibility, created_at';

export type ActivityRow = {
  id: string;
  verb: string;
  actor_id: string | null;
  artist_id: string | null;
  project_id: string | null;
  song_id: string | null;
  release_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  payload: unknown;
  visibility: string;
  created_at: string;
};

export type FeedEvent = DigestEvent & {
  subjectType: string | null;
  visibility: 'internal' | 'artist';
};

const ITEMS: readonly ReleaseItemsChange[] = ['added', 'removed', 'reordered', 'edited'];
const TITLE_MAX = 120;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The few payload fields a feed carries. Everything else a payload holds
 * (field lists, relation names, ids of other rows, anything a future verb adds)
 * stays in the table: a feed is built field by field and never spreads a row.
 */
function summarize(payload: unknown, verb: string): EventSummary {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const p = payload as Record<string, unknown>;
  const out: EventSummary = {};
  const title = str(p.title);
  if (title) out.title = title.slice(0, TITLE_MAX);
  if (typeof p.items === 'string' && (ITEMS as readonly string[]).includes(p.items)) out.items = p.items as ReleaseItemsChange;
  if (p.state && typeof p.state === 'object' && !Array.isArray(p.state)) {
    const s = p.state as Record<string, unknown>;
    const from = str(s.from);
    const to = str(s.to);
    if (from || to) out.state = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  const from = str(p.from);
  const to = str(p.to);
  if (verb === 'song.stage_changed' && isSongStage(from) && isSongStage(to)) out.move = { from, to };
  if (verb === 'song.reviewed') {
    // Rating and verdict only (null = the reviewer cleared it): the payload never holds the note, and a feed would not spread it if it did.
    const rating = p.rating === null ? null : typeof p.rating === 'number' && Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 5 ? p.rating : undefined;
    const verdict = p.verdict === null ? null : isReviewVerdict(p.verdict) ? p.verdict : undefined;
    if (rating !== undefined || verdict !== undefined) out.review = { ...(rating !== undefined ? { rating } : {}), ...(verdict !== undefined ? { verdict } : {}) };
  }
  const stage = str(p.song_stage);
  if (stage) out.stage = stage;
  return out;
}

const lower = (v: string | null): string | null => (v === null ? null : v.toLowerCase());

export function toFeedEvent(row: ActivityRow): FeedEvent {
  return {
    id: row.id,
    verb: row.verb,
    at: row.created_at,
    actorId: row.actor_id,
    artistId: lower(row.artist_id),
    projectId: lower(row.project_id),
    songId: lower(row.song_id),
    releaseId: lower(row.release_id),
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    visibility: row.visibility === 'artist' ? 'artist' : 'internal',
    summary: summarize(row.payload, row.verb),
  };
}

export type FeedViewer = {
  capabilities: ReadonlySet<string>;
  /** null = the whole org (artist-scope.ts). */
  artistScope: ArtistScope;
  /** The org projects the scope reaches (`orgProjectIdsInScope`); null = all. */
  projectsInScope: ReadonlySet<string> | null;
};

export function eventVisibleTo(
  viewer: FeedViewer,
  e: { visibility: string; artistId: string | null; projectId: string | null },
): boolean {
  if (!viewer.capabilities.has('catalog.read')) return false;
  if (e.visibility !== 'artist' && !viewer.capabilities.has('business.read.internal')) return false;
  if (viewer.artistScope === null) return true;
  if (e.artistId) return scopeAllowsContact(viewer.artistScope, e.artistId);
  if (e.projectId) return viewer.projectsInScope?.has(e.projectId.toLowerCase()) ?? false;
  return false;
}

/**
 * project id → the roster artists to file its events under: the Inbox artist
 * first, then the linked contacts. For a scoped member only artists in their
 * scope survive, so a heading can never name an artist they were not given.
 */
export function projectArtistsFor(
  projects: ReadonlyArray<{ id: string; inbox_for_contact_id: string | null }>,
  links: ReadonlyArray<{ project_id: string; contact_id: string }>,
  scope: ArtistScope,
): Map<string, string[]> {
  const out = new Map<string, string[]>(projects.map((p) => [p.id.toLowerCase(), p.inbox_for_contact_id ? [p.inbox_for_contact_id.toLowerCase()] : []]));
  for (const l of links) out.get(l.project_id.toLowerCase())?.push(l.contact_id.toLowerCase());
  if (scope !== null) for (const [id, list] of out) out.set(id, list.filter((c) => scope.has(c)));
  return out;
}

/**
 * D4 on top of scope: an event about a song whose row the member may not
 * read (working material for marketing, 07 §3.4) is left out and counted, so
 * the page can say "restricted" instead of looking empty. A song the loader
 * could not classify is not in `visibleSongIds` either — fail closed.
 */
export function withholdHiddenSongs<T extends { songId: string | null }>(
  events: readonly T[],
  visibleSongIds: ReadonlySet<string>,
): { kept: T[]; withheld: number } {
  const kept: T[] = [];
  let withheld = 0;
  for (const e of events) {
    if (e.songId === null || visibleSongIds.has(e.songId)) kept.push(e);
    else withheld += 1;
  }
  return { kept, withheld };
}

// ── Paging ──────────────────────────────────────────────────────────────

/**
 * A page boundary is a position in (created_at DESC, id DESC) — the feed's
 * order — written `<created_at>_<id>`. `created_at` alone is not enough: events
 * recorded in one transaction share a `now()`, and a boundary inside such a
 * group would drop the rest of it.
 */
export type FeedCursor = { at: string; id: string | null };

export const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})(?:_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;

export function formatCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}_${row.id}`;
}

/** Null for anything that is not a cursor (the route has validated it already; this never throws). */
export function parseCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw || !CURSOR_RE.test(raw)) return null;
  const cut = raw.indexOf('_');
  return cut < 0 ? { at: raw, id: null } : { at: raw.slice(0, cut), id: raw.slice(cut + 1).toLowerCase() };
}
