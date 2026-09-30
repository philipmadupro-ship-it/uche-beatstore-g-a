/**
 * Portal comments: one artist's conversation with the producer, stored in
 * `project_comments` with `contact_id` set (mig 128) — the same rows,
 * threading and time-range pins the share pages use.
 *
 * Two audiences read the same rows:
 *   - the portal, which must see ONLY its own artist's thread and never a
 *     stored field it does not need (no user id, no share token, no email);
 *   - the producer's workspace, which sees the thread per artist.
 * Both go through `toPortalComment`, built field by field.
 */

export interface CommentRow {
  id: string;
  project_id: string;
  track_id: string | null;
  user_id: string | null;
  parent_id: string | null;
  author_name: string | null;
  body: string;
  region_start: number | string | null;
  region_end: number | string | null;
  created_at: string;
  deleted_at?: string | null;
}

export const PORTAL_COMMENT_COLUMNS = 'id, project_id, track_id, user_id, parent_id, author_name, body, region_start, region_end, created_at, deleted_at';

export interface PortalComment {
  id: string;
  projectId: string;
  trackId: string | null;
  parentId: string | null;
  body: string;
  regionStart: number | null;
  regionEnd: number | null;
  createdAt: string;
  /** Written by the producer (a signed-in owner), not the artist. */
  fromProducer: boolean;
  authorName: string;
}

function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toPortalComment(row: CommentRow, names: { artistName: string; producerName: string }): PortalComment {
  const fromProducer = !!row.user_id;
  const start = num(row.region_start);
  const end = num(row.region_end);
  const pinned = start != null && end != null && end > start;
  return {
    id: row.id,
    projectId: row.project_id,
    trackId: row.track_id,
    parentId: row.parent_id,
    body: row.body,
    regionStart: pinned ? start : null,
    regionEnd: pinned ? end : null,
    createdAt: row.created_at,
    fromProducer,
    authorName: (fromProducer ? names.producerName : names.artistName).trim() || (fromProducer ? 'Producer' : 'Artist'),
  };
}

export interface CommentThread {
  root: PortalComment;
  replies: PortalComment[];
}

/**
 * Roots oldest-first with their replies oldest-first. A reply whose root is
 * missing (deleted, or outside the rows given) is shown as a root rather than
 * dropped, so nothing the artist wrote disappears.
 */
export function threadComments(comments: readonly PortalComment[]): CommentThread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const threads = new Map<string, CommentThread>();
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const c of sorted) {
    if (!c.parentId || !byId.has(c.parentId)) threads.set(c.id, { root: c, replies: [] });
  }
  for (const c of sorted) {
    if (!c.parentId || !byId.has(c.parentId)) continue;
    // Walk up to the thread root (replies to replies stay in one thread).
    let root = byId.get(c.parentId)!;
    const seen = new Set<string>([c.id]);
    while (root.parentId && byId.has(root.parentId) && !seen.has(root.id)) {
      seen.add(root.id);
      root = byId.get(root.parentId)!;
    }
    threads.get(root.id)?.replies.push(c);
  }
  return [...threads.values()];
}

/** "1:23" */
export function formatTimecode(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The pin an artist gets from "comment at the current position": a 5-second
 * range from the playhead (the table requires end > start), clipped to the
 * track. Null when there is no usable position.
 */
export function pinAt(fraction: number, durationSeconds: number | null): { region_start: number; region_end: number } | null {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null;
  const start = Math.round(fraction * durationSeconds * 10) / 10;
  const end = Math.min(durationSeconds, start + 5);
  if (end <= start) return null;
  return { region_start: start, region_end: Math.round(end * 10) / 10 };
}

/* ── The producer's notification ───────────────────────────────────────── */

export const PORTAL_COMMENT_KIND = 'portal_comment';

const PREVIEW_MAX = 140;

export interface PortalCommentNotificationInput {
  ownerId: string;
  contactId: string;
  contactName: string;
  commentId: string;
  projectId: string;
  projectName: string | null;
  trackId: string | null;
  trackTitle: string | null;
  body: string;
  isReply: boolean;
  regionStart: number | null;
}

export function buildPortalCommentNotification(input: PortalCommentNotificationInput) {
  const who = input.contactName.trim() || 'An artist';
  const where = input.trackTitle?.trim() || input.projectName?.trim() || 'their portal';
  const at = input.regionStart != null ? ` at ${formatTimecode(input.regionStart)}` : '';
  const flat = input.body.replace(/\s+/g, ' ').trim();
  return {
    user_id: input.ownerId,
    kind: PORTAL_COMMENT_KIND,
    title: `${who} ${input.isReply ? 'replied on' : 'commented on'} ${where}${at}`,
    body: flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat,
    data: {
      contact_id: input.contactId,
      comment_id: input.commentId,
      project_id: input.projectId,
      track_id: input.trackId,
    },
  };
}
