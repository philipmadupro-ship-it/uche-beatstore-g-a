/**
 * PATCH  /api/org/[orgId]/projects/[id]/comments/[commentId]
 *        { body?, visibility?, resolved? } — edit the words (the author),
 *        change who reads it (the author or an owner / admin, team only),
 *        resolve or reopen the thread (anyone who may comment; roots only).
 * DELETE /api/org/[orgId]/projects/[id]/comments/[commentId] — soft delete
 *        the comment and the replies under it (the author, or an owner /
 *        admin).
 *
 * LABEL-22. Served to org members and to external project members of this
 * project. A comment the caller may not read (internal, for an artist or an
 * external member) answers 404 — its existence is not theirs to learn — and
 * a comment of another project, org or conversation (portal, share link) is
 * the same 404. Making a thread internal makes every reply under it
 * internal in the same step, because migration 150 refuses an artist-visible
 * reply under an internal comment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireProjectActor } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgCommentPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import {
  canChangeVisibility,
  canDeleteComment,
  canEditComment,
  canResolveThread,
  ORG_COMMENT_COLUMNS,
  toOrgComment,
  visibleToActor,
  type OrgCommentRow,
} from '@/lib/labelos/org-comments';
import {
  commentActorOf,
  CommentsNotReadyError,
  COMMENTS_NOT_READY,
  descendantIds,
  projectCommentRow,
  readableTracks,
} from '@/lib/labelos/org-comments-store';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.comments.item');

type Params = { params: Promise<{ orgId: string; id: string; commentId: string }> };

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, id, commentId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization comments need Supabase.' });
  const access = await requireProjectActor({ projectId: id, orgId, cap: 'catalog.read' });
  if (!access.ok) return access.res;
  const { admin, orgId: org, userId } = access.access;
  const actor = commentActorOf(access, id);
  const parsed = await readBody(req, OrgCommentPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const change = parsed.data;

  try {
    const row = await projectCommentRow(admin, org, id, commentId);
    if (!row || !visibleToActor(row, actor)) return json(404, { error: 'Not found' });
    if (row.track_id && !(await readableTracks(admin, org, actor, [row.track_id])).has(row.track_id)) return json(404, { error: 'Not found' });

    const patch: Record<string, unknown> = {};
    const now = new Date().toISOString();
    let cascadeInternal = false;

    if (change.body !== undefined && change.body !== row.body) {
      if (!canEditComment(row, actor)) return json(403, { error: 'Forbidden' });
      patch.body = change.body;
      patch.edited_at = now;
    }

    const wasInternal = (row.visibility ?? 'artist') === 'internal';
    if (change.visibility !== undefined && (change.visibility === 'internal') !== wasInternal) {
      if (!canChangeVisibility(row, actor)) return json(403, { error: 'Forbidden' });
      if (change.visibility === 'artist' && row.parent_id) {
        // A reply under a team-only comment stays team-only (migration 150).
        const root = await projectCommentRow(admin, org, id, row.parent_id);
        if (!root || (root.visibility ?? 'artist') === 'internal') return json(409, { error: 'This reply is under a team-only comment. Make the whole thread visible instead.' });
      }
      patch.visibility = change.visibility;
      cascadeInternal = change.visibility === 'internal';
    }

    let resolveChange: boolean | null = null;
    if (change.resolved !== undefined && change.resolved !== (row.resolved_at != null)) {
      if (!canResolveThread(actor)) return json(403, { error: 'Forbidden' });
      if (row.parent_id) return json(400, { error: 'Resolve the thread, not a reply.' });
      patch.resolved_at = change.resolved ? now : null;
      patch.resolved_by = change.resolved ? userId : null;
      resolveChange = change.resolved;
    }

    if (Object.keys(patch).length === 0) return json(200, { comment: toOrgComment(row, actor) });

    // A thread made internal takes its replies with it, in ONE statement with
    // the root: a failure leaves the thread as it was, never an artist-visible
    // reply under a team-only root. (The trigger that refuses such a reply
    // fires on each row's own update, so the order inside the statement does not matter.)
    if (cascadeInternal) {
      const replies = await descendantIds(admin, id, row.id);
      const flipped = await admin.from('project_comments').update({ visibility: 'internal' }).in('id', [row.id, ...replies]).eq('org_id', org).eq('project_id', id);
      if (flipped.error) throw flipped.error;
      delete patch.visibility;
    }

    let updated = row;
    if (Object.keys(patch).length > 0) {
      const { data, error } = await admin
        .from('project_comments')
        .update(patch)
        .eq('id', row.id)
        .eq('org_id', org)
        .eq('project_id', id)
        .select(ORG_COMMENT_COLUMNS)
        .single();
      if (error) throw error;
      updated = data as unknown as OrgCommentRow;
    } else {
      const { data, error } = await admin.from('project_comments').select(ORG_COMMENT_COLUMNS).eq('id', row.id).eq('org_id', org).single();
      if (error) throw error;
      updated = data as unknown as OrgCommentRow;
    }

    const visibility = (updated.visibility ?? 'artist') === 'internal' ? 'internal' : 'artist';
    const ctx = { orgId: org, userId };
    const subject = { type: 'comment' as const, id: row.id, projectId: id, songId: row.track_id };
    if (patch.body !== undefined || patch.visibility !== undefined) {
      await recordEvent(admin, ctx, 'comment.updated', subject, { fields: ['body', 'visibility'].filter((f) => f in patch), visibility }, { visibility });
    }
    if (resolveChange !== null) {
      await recordEvent(admin, ctx, 'comment.resolved', subject, { resolved: resolveChange, visibility }, { visibility });
    }
    return json(200, { comment: toOrgComment(updated, actor) });
  } catch (err) {
    if (err instanceof CommentsNotReadyError) return json(503, { error: COMMENTS_NOT_READY, migration: '150', schemaReady: false });
    log.error('patch failed', { projectId: id, commentId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the comment' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, id, commentId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization comments need Supabase.' });
  const access = await requireProjectActor({ projectId: id, orgId, cap: 'catalog.read' });
  if (!access.ok) return access.res;
  const { admin, orgId: org, userId } = access.access;
  const actor = commentActorOf(access, id);

  try {
    const row = await projectCommentRow(admin, org, id, commentId);
    if (!row || !visibleToActor(row, actor)) return json(404, { error: 'Not found' });
    if (row.track_id && !(await readableTracks(admin, org, actor, [row.track_id])).has(row.track_id)) return json(404, { error: 'Not found' });
    if (!canDeleteComment(row, actor)) return json(403, { error: 'Forbidden' });

    const ids = [row.id, ...(await descendantIds(admin, id, row.id))];
    const { error } = await admin
      .from('project_comments')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids)
      .eq('org_id', org)
      .eq('project_id', id);
    if (error) throw error;

    const visibility = (row.visibility ?? 'artist') === 'internal' ? 'internal' : 'artist';
    await recordEvent(
      admin,
      { orgId: org, userId },
      'comment.deleted',
      { type: 'comment', id: row.id, projectId: id, songId: row.track_id },
      { replies: ids.length - 1, visibility },
      { visibility },
    );
    return json(200, { success: true });
  } catch (err) {
    if (err instanceof CommentsNotReadyError) return json(503, { error: COMMENTS_NOT_READY, migration: '150', schemaReady: false });
    log.error('delete failed', { projectId: id, commentId, error: errorMessage(err) });
    return json(500, { error: 'Could not delete the comment' });
  }
}
