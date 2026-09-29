import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { PortalCommentBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortal } from '@/lib/artist-portal/gate';
import { portalProjectLinks } from '@/lib/artist-portal/membership';
import { isSchemaNotReady } from '@/lib/artists/http';
import {
  buildPortalCommentNotification,
  PORTAL_COMMENT_COLUMNS,
  toPortalComment,
  type CommentRow,
} from '@/lib/artist-portal/comments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.comments');

async function names(admin: ReturnType<typeof createServiceClient>, ownerId: string, contactId: string) {
  const [contact, profile] = await Promise.all([
    admin.from('contacts').select('name').eq('id', contactId).eq('user_id', ownerId).maybeSingle(),
    admin.from('creator_profiles').select('display_name').eq('user_id', ownerId).maybeSingle(),
  ]);
  return {
    artistName: (contact.data as { name?: string | null } | null)?.name ?? '',
    producerName: (profile.data as { display_name?: string | null } | null)?.display_name ?? '',
  };
}

/**
 * GET  /api/portal/[token]/comments — this artist's thread across their
 *      portal projects: their own comments and the producer's replies in
 *      their thread (`contact_id` = this portal's contact). Never another
 *      artist's, never share-page comments.
 * POST /api/portal/[token]/comments — { project_id, track_id?, parent_id?,
 *      body, region_start?, region_end? }. The project must be in the portal
 *      and allow comments (`project_contacts.can_comment`); the track must be
 *      in that project; a reply must answer a comment in this artist's
 *      thread. Notifies the producer and lands on the contact's timeline.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalcomments:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;
    const links = await portalProjectLinks(admin, portal);
    if (links.length === 0) return NextResponse.json({ comments: [] }, { headers: { 'cache-control': 'private, no-store' } });

    const { data, error } = await admin
      .from('project_comments')
      .select(PORTAL_COMMENT_COLUMNS)
      .in('project_id', links.map((l) => l.project_id))
      .eq('contact_id', portal.contact_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    const n = await names(admin, portal.user_id, portal.contact_id);
    return NextResponse.json(
      { comments: ((data ?? []) as CommentRow[]).map((r) => toPortalComment(r, n)) },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ comments: [] });
    log.error('portal comments load failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalcomment:${clientIp(req)}`, 10, 60_000))
    || !(await rateLimitDurable(`portalcomment:t:${token}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const parsed = PortalCommentBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
  const body = parsed.data;

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;

    const link = (await portalProjectLinks(admin, portal)).find((l) => l.project_id === body.project_id);
    if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!link.can_comment) return NextResponse.json({ error: 'Comments are off for this project.' }, { status: 403 });

    const trackId = body.track_id ?? null;
    if (trackId) {
      const { data: pt, error: ptErr } = await admin
        .from('project_tracks')
        .select('track_id')
        .eq('project_id', body.project_id)
        .eq('track_id', trackId)
        .limit(1);
      if (ptErr) throw ptErr;
      if (!pt || pt.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const parentId = body.parent_id ?? null;
    if (parentId) {
      const { data: parent, error: pErr } = await admin
        .from('project_comments')
        .select('id')
        .eq('id', parentId)
        .eq('project_id', body.project_id)
        .eq('contact_id', portal.contact_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const n = await names(admin, portal.user_id, portal.contact_id);
    const regionStart = body.region_start ?? null;
    const regionEnd = regionStart != null ? body.region_end ?? null : null;

    const { data, error } = await admin
      .from('project_comments')
      .insert({
        project_id: body.project_id,
        track_id: trackId,
        user_id: null,
        share_token: null,
        contact_id: portal.contact_id,
        author_name: n.artistName || 'Artist',
        body: body.body,
        parent_id: parentId,
        region_start: regionStart,
        region_end: regionEnd,
      })
      .select(PORTAL_COMMENT_COLUMNS)
      .single();
    if (error) throw error;
    const comment = toPortalComment(data as CommentRow, n);

    // Tell the producer. Best-effort: the comment is saved.
    const [project, track] = await Promise.all([
      admin.from('projects').select('name').eq('id', body.project_id).eq('user_id', portal.user_id).maybeSingle(),
      trackId ? admin.from('tracks').select('title').eq('id', trackId).eq('user_id', portal.user_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const projectName = (project.data as { name?: string | null } | null)?.name ?? null;
    const trackTitle = (track.data as { title?: string | null } | null)?.title ?? null;
    const note = buildPortalCommentNotification({
      ownerId: portal.user_id,
      contactId: portal.contact_id,
      contactName: n.artistName,
      commentId: comment.id,
      projectId: body.project_id,
      projectName,
      trackId,
      trackTitle,
      body: body.body,
      isReply: !!parentId,
      regionStart,
    });
    const [nRes, aRes] = await Promise.all([
      admin.from('notifications').insert(note),
      admin.from('contact_activity').insert({
        contact_id: portal.contact_id,
        user_id: portal.user_id,
        kind: 'portal_comment',
        title: note.title,
        body: body.body.slice(0, 1000),
        metadata: { comment_id: comment.id, project_id: body.project_id, track_id: trackId },
      }),
    ]);
    if (nRes.error) log.warn('comment notification failed', { error: errorMessage(nRes.error) });
    if (aRes.error) log.warn('comment timeline row failed', { error: errorMessage(aRes.error) });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ error: 'Comments are not available yet.' }, { status: 503 });
    log.error('portal comment failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
