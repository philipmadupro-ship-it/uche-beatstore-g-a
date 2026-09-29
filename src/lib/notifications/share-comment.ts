/**
 * The notification row for a comment left on a share page.
 *
 * Guests comment through `/api/projects/share/[token]/comments`, and until
 * this existed nothing told the producer: artist feedback sat in
 * `project_comments` until the project happened to be opened. The bell, its
 * realtime subscription and the desktop alerts all read the `notifications`
 * table, so one row here reaches all three.
 *
 * Pure so the wording and the privacy rules are tested: the row never carries
 * the share token (a bearer credential) — only ids the producer already owns.
 */

export const SHARE_COMMENT_KIND = 'share_comment';

/** Long enough to read the point of a note, short enough for the bell's two lines. */
export const SHARE_COMMENT_EXCERPT_CHARS = 140;

export interface ShareCommentInput {
  ownerId: string;
  commentId: string;
  projectId: string | null;
  projectName?: string | null;
  trackId?: string | null;
  trackTitle?: string | null;
  authorName: string;
  body: string;
  parentId?: string | null;
  regionStart?: number | null;
  regionEnd?: number | null;
}

export interface ShareCommentNotificationRow {
  user_id: string;
  kind: typeof SHARE_COMMENT_KIND;
  title: string;
  body: string;
  data: {
    dedupe_key: string;
    comment_id: string;
    project_id: string | null;
    track_id: string | null;
    parent_id: string | null;
    author_name: string;
    region_start: number | null;
    region_end: number | null;
  };
}

/** Seconds → `m:ss`. Negative or non-finite input reads as 0:00. */
export function formatCommentTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SHARE_COMMENT_EXCERPT_CHARS) return flat;
  return `${flat.slice(0, SHARE_COMMENT_EXCERPT_CHARS - 1).trimEnd()}…`;
}

export function buildShareCommentNotification(input: ShareCommentInput): ShareCommentNotificationRow {
  const author = input.authorName.trim() || 'Someone';
  const where = input.projectName?.trim() || 'a shared project';
  const verb = input.parentId ? 'replied on' : 'commented on';

  const hasRegion = input.regionStart != null && input.regionEnd != null && input.regionEnd > input.regionStart;
  const context = [
    input.trackTitle?.trim() ? `“${input.trackTitle.trim()}”` : null,
    hasRegion ? `${formatCommentTime(input.regionStart as number)}–${formatCommentTime(input.regionEnd as number)}` : null,
  ].filter(Boolean).join(' · ');

  return {
    user_id: input.ownerId,
    kind: SHARE_COMMENT_KIND,
    title: `${author} ${verb} ${where}`,
    body: context ? `${context} · ${excerpt(input.body)}` : excerpt(input.body),
    data: {
      dedupe_key: `share_comment_${input.commentId}`,
      comment_id: input.commentId,
      project_id: input.projectId,
      track_id: input.trackId ?? null,
      parent_id: input.parentId ?? null,
      author_name: author,
      region_start: hasRegion ? (input.regionStart as number) : null,
      region_end: hasRegion ? (input.regionEnd as number) : null,
    },
  };
}
