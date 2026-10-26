/**
 * Org comments (LABEL-22, 17 R5): threaded, region-pinned comments on an org
 * project, stored in `project_comments` — the same rows the share pages and
 * the artist portal use, extended by migration 150 with `org_id`,
 * `visibility` and `resolved_at`. Pure; the route
 * (`/api/org/[orgId]/projects/[id]/comments`) reads and writes rows, this
 * module decides.
 *
 * The rule the task exists for: an `internal` comment is a note for the
 * org's team. It NEVER reaches a portal, a share page, a roster artist (role
 * `artist`) or an external project member. `canReadInternal` is the single
 * answer; the SQL twin is `labelos_can_read_internal_comments` (150), and
 * the portal / share / producer routes filter `visibility` as well.
 *
 * Built FIELD BY FIELD (`toOrgComment`): no stored user id, share token,
 * contact id or org id leaves the server — only what a reader needs.
 */

import { externalCan, type Capability, type ExternalProjectRole } from './capabilities';

export const COMMENT_VISIBILITIES = ['artist', 'internal'] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export function isCommentVisibility(v: unknown): v is CommentVisibility {
  return typeof v === 'string' && (COMMENT_VISIBILITIES as readonly string[]).includes(v);
}

export const ORG_COMMENT_MAX_LENGTH = 5000;

/** The columns the route reads. Never `*`: the row carries a share token and a contact id. */
export const ORG_COMMENT_COLUMNS =
  'id, project_id, track_id, user_id, author_name, body, parent_id, region_start, region_end, visibility, resolved_at, edited_at, created_at';

export interface OrgCommentRow {
  id: string;
  project_id: string;
  track_id: string | null;
  user_id: string | null;
  author_name: string | null;
  body: string;
  parent_id: string | null;
  region_start: number | string | null;
  region_end: number | string | null;
  /** Missing before migration 150: reads as 'artist'. */
  visibility?: string | null;
  resolved_at?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
}

// ── Who may do what ─────────────────────────────────────────────────────

/**
 * The caller. `org` actors are org members (their role and capabilities come
 * from lib/auth/org-access); `external` actors are project members from
 * outside the org (LABEL-21), who hold a §2.6 role and nothing else.
 */
export type CommentActor =
  | { kind: 'org'; userId: string; role: string; capabilities: ReadonlySet<Capability | string> }
  | { kind: 'external'; userId: string; role: ExternalProjectRole | string };

/**
 * Internal notes are for the org's team: owner, admin and member. A roster
 * artist (role `artist`) never reads one — whatever capabilities an override
 * gave them — and an external member is not on the team.
 */
export function canReadInternal(actor: CommentActor): boolean {
  return actor.kind === 'org' && (actor.role === 'owner' || actor.role === 'admin' || actor.role === 'member');
}

/**
 * Comment (and reply, and resolve). An org member needs the §2.4 comment
 * ability: `review.comment` (an artist, anyone with `review.write`) or
 * `catalog.write` (producers and engineers, who give notes on mixes without
 * rating them). An external member needs the §2.6 `comment` cell: commenter
 * and above.
 */
export function canComment(actor: CommentActor): boolean {
  if (actor.kind === 'external') return externalCan(actor.role, 'comment');
  return actor.capabilities.has('review.comment') || actor.capabilities.has('catalog.write');
}

/** Write a team-only note: someone who may comment AND may read the team's notes. */
export function canPostInternal(actor: CommentActor): boolean {
  return canComment(actor) && canReadInternal(actor);
}

/** A comment the actor may see at all. */
export function visibleToActor(row: Pick<OrgCommentRow, 'visibility'>, actor: CommentActor): boolean {
  return (row.visibility ?? 'artist') !== 'internal' || canReadInternal(actor);
}

const isAuthor = (row: Pick<OrgCommentRow, 'user_id'>, actor: CommentActor) => row.user_id != null && row.user_id === actor.userId;
const isAdmin = (actor: CommentActor) => actor.kind === 'org' && (actor.role === 'owner' || actor.role === 'admin');

/** Edit the words: the author, while they may still comment. */
export function canEditComment(row: Pick<OrgCommentRow, 'user_id'>, actor: CommentActor): boolean {
  return isAuthor(row, actor) && canComment(actor);
}

/** Delete: the author (while a member of the project), or the org's owner / admin as moderation. */
export function canDeleteComment(row: Pick<OrgCommentRow, 'user_id'>, actor: CommentActor): boolean {
  return isAuthor(row, actor) || isAdmin(actor);
}

/** Resolve or reopen a thread: anyone who may comment on the project. */
export function canResolveThread(actor: CommentActor): boolean {
  return canComment(actor);
}

/**
 * Change who may read a comment: the author or an owner / admin, and only a
 * team member (it is the team that decides what the artist sees).
 */
export function canChangeVisibility(row: Pick<OrgCommentRow, 'user_id'>, actor: CommentActor): boolean {
  return canPostInternal(actor) && (isAuthor(row, actor) || isAdmin(actor));
}

/**
 * The visibility a new comment gets. Default `artist`; `internal` only for a
 * team member, and a reply under an internal comment is internal whatever was
 * asked (migration 150's trigger refuses anything else). `null` = refused.
 */
export function resolveNewVisibility(
  requested: CommentVisibility | undefined,
  actor: CommentActor,
  parent: Pick<OrgCommentRow, 'visibility'> | null,
): CommentVisibility | null {
  const parentInternal = (parent?.visibility ?? 'artist') === 'internal';
  const want: CommentVisibility = parentInternal ? 'internal' : (requested ?? 'artist');
  if (want === 'internal' && !canPostInternal(actor)) return null;
  return want;
}

// ── The shape that leaves the server ────────────────────────────────────

export interface OrgComment {
  id: string;
  projectId: string;
  trackId: string | null;
  parentId: string | null;
  body: string;
  authorName: string;
  /** Written by the caller. */
  mine: boolean;
  regionStart: number | null;
  regionEnd: number | null;
  visibility: CommentVisibility;
  resolvedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  /** What THIS caller may do to this comment, decided here so the screen never guesses (and never offers what the route would refuse). */
  can: { edit: boolean; delete: boolean; changeVisibility: boolean };
  /** Set when this thread is an UNRESOLVED one carried over from an earlier version of the same song. */
  carriedFrom: { trackId: string; label: string } | null;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toOrgComment(row: OrgCommentRow, actor: CommentActor, carriedFrom: OrgComment['carriedFrom'] = null): OrgComment {
  const start = num(row.region_start);
  const end = num(row.region_end);
  const pinned = start != null && end != null && end > start;
  return {
    id: row.id,
    projectId: row.project_id,
    trackId: row.track_id,
    parentId: row.parent_id,
    body: row.body,
    authorName: (row.author_name ?? '').trim() || 'Member',
    mine: row.user_id != null && row.user_id === actor.userId,
    regionStart: pinned ? start : null,
    regionEnd: pinned ? end : null,
    visibility: (row.visibility ?? 'artist') === 'internal' ? 'internal' : 'artist',
    resolvedAt: row.resolved_at ?? null,
    editedAt: row.edited_at ?? null,
    createdAt: row.created_at,
    can: { edit: canEditComment(row, actor), delete: canDeleteComment(row, actor), changeVisibility: canChangeVisibility(row, actor) },
    carriedFrom,
  };
}

/**
 * The region of a new comment: both bounds or neither, end after start (the
 * table's CHECK, applied up front so a half-set pin becomes a track-level
 * comment instead of a 500).
 */
export function normalizeRegion(start: number | null | undefined, end: number | null | undefined): { region_start: number | null; region_end: number | null } {
  if (typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
    return { region_start: start, region_end: end };
  }
  return { region_start: null, region_end: null };
}

// ── Versions and carry-forward ──────────────────────────────────────────

/** One link row between tracks: "to is from's <relation>" (lib/tracks/links). */
export interface VersionLink {
  from_track_id: string;
  to_track_id: string;
  relation: string;
  position?: number | null;
  created_at?: string | null;
}

export interface MixVersion {
  trackId: string;
  /** "mix v1" for the song's own recording, "mix v2" for the first version added to it, … */
  label: string;
}

export const mixLabel = (n: number) => `mix v${n}`;

/**
 * The versions of the song `trackId` belongs to, oldest first. A song's own
 * recording is `mix v1`; every `version` link FROM it appends the next, in
 * the order they were added (`created_at`, then `position`, then id — stable
 * and total). The NEWEST is the current mix: a version is appended and never
 * replaces anything (W4), and `songRecordings` already treats the others as
 * earlier takes. A track in no version chain is a chain of one.
 */
export function versionChain(trackId: string, links: readonly VersionLink[]): MixVersion[] {
  const versions = links.filter((l) => l.relation === 'version');
  const asVersion = versions.find((l) => l.to_track_id === trackId);
  // A version of a version is not modelled (the upload route links to the
  // song); if one exists, climb to the root so the chain stays one list.
  let root = trackId;
  const seen = new Set<string>([trackId]);
  for (let up = asVersion; up && !seen.has(up.from_track_id); up = versions.find((l) => l.to_track_id === root)) {
    root = up.from_track_id;
    seen.add(root);
  }
  const added = versions
    .filter((l) => l.from_track_id === root)
    .sort(
      (a, b) =>
        String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
        (a.position ?? 0) - (b.position ?? 0) ||
        a.to_track_id.localeCompare(b.to_track_id),
    );
  const ids = [root, ...added.map((l) => l.to_track_id).filter((id) => id !== root)];
  return [...new Set(ids)].map((id, i) => ({ trackId: id, label: mixLabel(i + 1) }));
}

export interface CarryResult {
  /** The unresolved ROOT threads, oldest first, each with the version it was written on. */
  carried: { comment: OrgCommentRow; from: MixVersion }[];
}

/**
 * Carry-forward: the unresolved comments on SUPERSEDED versions of a song
 * show on its current one, labelled with where they came from ("from mix
 * v2"). Exactly those:
 *   - roots only (a reply travels with its thread, `repliesOf`);
 *   - unresolved (a resolved thread is done and stays where it was written);
 *   - pinned to an EARLIER version of the same song (comments on the current
 *     one are native, project-level ones and other songs' are not carried);
 *   - not deleted.
 * Only the current (newest) version carries; asking from an older one carries
 * nothing. Visibility is NOT decided here: pass rows the actor may already
 * see, so an internal comment cannot be carried to a reader who may not read it.
 */
export function carryForward(opts: {
  chain: readonly MixVersion[];
  currentTrackId: string;
  comments: readonly OrgCommentRow[];
}): CarryResult {
  const { chain, currentTrackId, comments } = opts;
  const current = chain[chain.length - 1];
  if (!current || current.trackId !== currentTrackId) return { carried: [] };
  const earlier = new Map(chain.slice(0, -1).map((v) => [v.trackId, v]));
  const carried = comments
    .filter((c) => !c.deleted_at && !c.parent_id && !c.resolved_at && c.track_id != null && earlier.has(c.track_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((comment) => ({ comment, from: earlier.get(comment.track_id!)! }));
  return { carried };
}

/** The replies of a set of root comments, at any depth (a reply to a reply stays in its thread). */
export function repliesOf(roots: ReadonlySet<string>, comments: readonly OrgCommentRow[]): OrgCommentRow[] {
  const known = new Set(roots);
  const out: OrgCommentRow[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of comments) {
      if (c.parent_id && known.has(c.parent_id) && !known.has(c.id) && !c.deleted_at) {
        known.add(c.id);
        out.push(c);
        grew = true;
      }
    }
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/**
 * What the list for one recording shows: its own comments (native), plus the
 * carried threads of earlier versions with their replies (`carriedFrom` set).
 * Without a track, every comment of the project, nothing carried.
 */
export function commentsForView(opts: {
  rows: readonly OrgCommentRow[];
  actor: CommentActor;
  trackId?: string | null;
  chain?: readonly MixVersion[];
}): OrgComment[] {
  const { rows, actor, trackId } = opts;
  const live = rows.filter((r) => !r.deleted_at && visibleToActor(r, actor));
  if (!trackId) return live.map((r) => toOrgComment(r, actor));
  const native = live.filter((r) => r.track_id === trackId);
  const { carried } = carryForward({ chain: opts.chain ?? [], currentTrackId: trackId, comments: live });
  const carriedIds = new Set(carried.map((c) => c.comment.id));
  const label = new Map(carried.map((c) => [c.comment.id, c.from]));
  const replies = repliesOf(carriedIds, live);
  // A reply's thread root decides where it came from.
  const byId = new Map(live.map((r) => [r.id, r]));
  const rootOf = (c: OrgCommentRow): string | null => {
    let cur: OrgCommentRow | undefined = c;
    const seen = new Set<string>();
    while (cur?.parent_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
    }
    return cur?.id ?? null;
  };
  const out: OrgComment[] = native.map((r) => toOrgComment(r, actor));
  for (const { comment, from } of carried) out.push(toOrgComment(comment, actor, { trackId: from.trackId, label: from.label }));
  for (const r of replies) {
    const from = label.get(rootOf(r) ?? '');
    if (from) out.push(toOrgComment(r, actor, { trackId: from.trackId, label: from.label }));
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
