/**
 * Notification for a comment left through a project share link.
 *
 * Share-page comments were written to `project_comments` and nothing else, so
 * an artist's feedback sat unseen until the producer happened to open that
 * project. Only purchases, buyer offers and fulfilment alerts ever reached
 * the bell (and the desktop notifications that ride on it). Pure so the
 * wording and truncation are tested rather than asserted inside the route.
 */
export interface ShareCommentInput {
  ownerId: string;
  projectId: string;
  projectName: string | null | undefined;
  authorName: string;
  body: string;
  commentId: string;
  shareToken: string;
  /** The share's owner-facing label (usually the recipient's name). */
  shareLabel?: string | null;
  trackId?: string | null;
  isReply?: boolean;
}

export interface NotificationInsert {
  user_id: string;
  kind: 'share_comment';
  title: string;
  body: string;
  data: Record<string, unknown>;
}

const PREVIEW_MAX = 140;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

export function shareCommentNotification(input: ShareCommentInput): NotificationInsert {
  const project = input.projectName?.trim() || 'a shared project';
  const verb = input.isReply ? 'replied on' : 'commented on';
  return {
    user_id: input.ownerId,
    kind: 'share_comment',
    title: `${input.authorName} ${verb} ${project}`,
    body: preview(input.body),
    data: {
      project_id: input.projectId,
      comment_id: input.commentId,
      share_token: input.shareToken,
      share_label: input.shareLabel ?? null,
      track_id: input.trackId ?? null,
    },
  };
}
