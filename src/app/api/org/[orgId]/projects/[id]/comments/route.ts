/**
 * GET  /api/org/[orgId]/projects/[id]/comments[?trackId=…] — an org project's
 *      comments (LABEL-22, 17 R5), threaded by the client, with the caller's
 *      abilities. With `trackId`, that recording's own comments plus the
 *      UNRESOLVED threads of its earlier versions, labelled "mix vN"
 *      (lib/labelos/org-comments#carryForward).
 * POST /api/org/[orgId]/projects/[id]/comments — comment, reply, or pin a
 *      comment to a moment ({ body, track_id?, parent_id?, region_start?,
 *      region_end?, visibility? }).
 *
 * Rows are `project_comments` (migration 150 adds org_id / visibility /
 * resolved_at); there is no comments table of our own. Served to org members
 * AND to external project members of THIS project (LABEL-21, requireProjectActor).
 *
 * `internal` is a note for the org's team. It is never listed to, and never
 * written by, a roster artist or an external member: the list query itself
 * excludes it for them, `visibleToActor` checks every row again, and the
 * database refuses to show it to their JWT (RLS, migration 150). Org
 * comments are written by the service role with the project's org; a portal
 * thread (`contact_id`) and a guest's share-link comment are other
 * conversations and are not part of this list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireProjectActor } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgCommentCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import {
  canComment,
  canPostInternal,
  commentsForView,
  normalizeRegion,
  ORG_COMMENT_COLUMNS,
  resolveNewVisibility,
  toOrgComment,
  versionChain,
  visibleToActor,
  type OrgCommentRow,
} from '@/lib/labelos/org-comments';
import {
  authorNameFor,
  commentActorOf,
  CommentsNotReadyError,
  COMMENTS_NOT_READY,
  commentsSchemaReady,
  onReadableTracks,
  projectCommentRow,
  projectCommentRows,
  projectTrackIds,
  readableTracks,
  recordingTitles,
  trackInProject,
  versionLinksAround,
} from '@/lib/labelos/org-comments-store';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { isUUID, readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.comments');

type Params = { params: Promise<{ orgId: string; id: string }> };

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(200, { schemaReady: false, comments: [] });
  const access = await requireProjectActor({ projectId: id, orgId, cap: 'catalog.read' });
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access.access;
  const actor = commentActorOf(access, id);

  const trackParam = req.nextUrl.searchParams.get('trackId');
  if (trackParam !== null && !isUUID(trackParam)) return json(404, { error: 'Not found' });

  try {
    // One read of the comments, one of the project's recordings, ONE audio-class
    // lookup for every track involved — then pure filtering.
    const all = await projectCommentRows(admin, org, id, actor);
    const placed = await projectTrackIds(admin, id);
    const readable = await readableTracks(admin, org, actor, [
      ...placed,
      ...all.map((r) => r.track_id).filter((t): t is string => !!t),
      ...(trackParam ? [trackParam] : []),
    ]);

    let trackId: string | null = null;
    if (trackParam) {
      // The recording must be one of the project's AND one this caller may hear (D4), or its notes are not theirs either.
      if (!placed.includes(trackParam) || !readable.has(trackParam)) return json(404, { error: 'Not found' });
      trackId = trackParam;
    }

    const rows = onReadableTracks(all, readable);
    const chain = trackId ? versionChain(trackId, await versionLinksAround(admin, trackId)) : [];
    const comments = commentsForView({ rows, actor, trackId, chain });
    const mix = trackId ? chain.find((v) => v.trackId === trackId) ?? null : null;
    // The picker's list, only for the screen that asks.
    const recordings = req.nextUrl.searchParams.get('recordings') === '1' ? await recordingTitles(admin, org, placed.filter((t) => readable.has(t))) : undefined;

    return json(200, {
      schemaReady: true,
      comments,
      version: mix ? { label: mix.label, current: chain[chain.length - 1]?.trackId === trackId } : null,
      ...(recordings ? { recordings } : {}),
      me: { canComment: canComment(actor), canPostInternal: canPostInternal(actor) },
    });
  } catch (err) {
    if (err instanceof CommentsNotReadyError) return json(200, { schemaReady: false, comments: [] });
    log.error('list failed', { projectId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not load comments' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization comments need Supabase.' });
  const access = await requireProjectActor({ projectId: id, orgId, cap: 'catalog.read' });
  if (!access.ok) return access.res;
  const { admin, orgId: org, userId } = access.access;
  const actor = commentActorOf(access, id);
  if (!canComment(actor)) return json(403, { error: 'Forbidden' });

  // Throttle per person: a comment box is the cheapest thing to hammer.
  if (!(await rateLimitDurable(`orgcomment:${userId}`, 30, 60_000))) return json(429, { error: 'Too many requests' });

  const parsed = await readBody(req, OrgCommentCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    if (!(await commentsSchemaReady(admin))) return json(503, { error: COMMENTS_NOT_READY, migration: '150', schemaReady: false });

    // A reply goes under its THREAD ROOT (threads are one level deep) and
    // takes the root's recording; it carries no region of its own.
    let parent: OrgCommentRow | null = null;
    if (body.parent_id) {
      parent = await projectCommentRow(admin, org, id, body.parent_id);
      if (parent?.parent_id) parent = await projectCommentRow(admin, org, id, parent.parent_id);
      // A comment the caller may not see does not exist for them.
      if (!parent || !visibleToActor(parent, actor)) return json(404, { error: 'Not found' });
    }

    const trackId = parent ? parent.track_id : body.track_id ?? null;
    if (trackId) {
      if (!(await trackInProject(admin, id, trackId))) return json(404, { error: 'Not found' });
      if (!(await readableTracks(admin, org, actor, [trackId])).has(trackId)) return json(403, { error: 'Forbidden' });
    }

    const visibility = resolveNewVisibility(body.visibility, actor, parent);
    if (!visibility) return json(403, { error: 'Only the team can write internal notes.' });

    const region = parent ? { region_start: null, region_end: null } : normalizeRegion(body.region_start, body.region_end);
    const authorName = await authorNameFor(admin, userId, actor);

    const { data, error } = await admin
      .from('project_comments')
      .insert({
        org_id: org,
        project_id: id,
        track_id: trackId,
        user_id: userId,
        share_token: null,
        contact_id: null,
        author_name: authorName,
        body: body.body,
        parent_id: parent?.id ?? null,
        visibility,
        ...region,
      })
      .select(ORG_COMMENT_COLUMNS)
      .single();
    if (error) throw error;
    const row = data as unknown as OrgCommentRow;

    // The event names the comment and where it is, never what it says.
    await recordEvent(
      admin,
      { orgId: org, userId },
      'comment.created',
      // `songId` is the recording: the feed hides an event about a recording the reader may not hear (D4).
      { type: 'comment', id: row.id, projectId: id, songId: trackId },
      { visibility, reply: !!parent, pinned: region.region_start != null, track: trackId },
      { visibility: visibility === 'internal' ? 'internal' : 'artist' },
    );
    return json(201, { comment: toOrgComment(row, actor) });
  } catch (err) {
    if (err instanceof CommentsNotReadyError) return json(503, { error: COMMENTS_NOT_READY, migration: '150', schemaReady: false });
    log.error('post failed', { projectId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not post the comment' });
  }
}
