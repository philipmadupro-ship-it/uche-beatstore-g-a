import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { PortalMessageBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortal } from '@/lib/artist-portal/gate';
import { portalProjectLinks } from '@/lib/artist-portal/membership';
import { isSchemaNotReady } from '@/lib/artists/http';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { loadThread, markRead, threadNames } from '@/lib/artist-messages/load';
import { ARTIST_MESSAGE_COLUMNS, buildArtistMessageNotification, toArtistMessage, type MessageRow } from '@/lib/artist-messages/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.messages');
const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * GET  /api/portal/[token]/messages[?read=1] — this artist's thread with the
 *      producer. `read=1` (the Messages tab is open) stamps the producer's
 *      messages as seen; the background poll never does.
 * POST /api/portal/[token]/messages — { body, kind: 'message' | 'request',
 *      project_id? }. A request may name a project in this portal. Notifies
 *      the producer and lands on the contact's timeline.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalmsgs:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;
    const links = await portalProjectLinks(admin, portal);
    const thread = await loadThread(admin, {
      userId: portal.user_id, contactId: portal.contact_id, audience: 'portal', projectIds: links.map((l) => l.project_id),
    });
    if (thread.schemaReady && req.nextUrl.searchParams.get('read') === '1') {
      const now = new Date().toISOString();
      const marked = await markRead(admin, { userId: portal.user_id, contactId: portal.contact_id, author: 'producer', now });
      if (marked > 0) for (const m of thread.messages) if (m.author === 'producer' && !m.readAt) m.readAt = now;
    }
    return NextResponse.json({ enabled: thread.schemaReady, messages: thread.messages }, { headers: NO_STORE });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ enabled: false, messages: [] }, { headers: NO_STORE });
    log.error('portal messages load failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalmsg:${clientIp(req)}`, 10, 60_000))
    || !(await rateLimitDurable(`portalmsg:t:${token}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const parsed = PortalMessageBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
  const body = parsed.data;

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;

    // Read first: PostgREST answers an insert into a missing table with an
    // empty 404 that isMissingSchema cannot recognise.
    const probe = await admin.from('artist_messages').select('id').limit(1);
    if (probe.error) {
      if (isMissingSchema(probe.error)) return NextResponse.json({ error: 'Messages are not available yet.' }, { status: 503 });
      throw probe.error;
    }

    const projectId = body.project_id ?? null;
    let projectName: string | null = null;
    if (projectId) {
      const link = (await portalProjectLinks(admin, portal)).find((l) => l.project_id === projectId);
      if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const { data: p } = await admin.from('projects').select('name').eq('id', projectId).eq('user_id', portal.user_id).maybeSingle();
      projectName = (p as { name?: string | null } | null)?.name ?? null;
    }

    const { data, error } = await admin
      .from('artist_messages')
      .insert({
        user_id: portal.user_id,
        contact_id: portal.contact_id,
        project_id: projectId,
        author: 'artist',
        kind: body.kind,
        body: body.body,
        request_status: body.kind === 'request' ? 'open' : null,
      })
      .select(ARTIST_MESSAGE_COLUMNS)
      .single();
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ error: 'Messages are not available yet.' }, { status: 503 });
      throw error;
    }
    const names = await threadNames(admin, portal.user_id, portal.contact_id);
    const message = toArtistMessage(data as MessageRow, {
      audience: 'portal', ...names, projectNames: projectId ? new Map([[projectId, projectName ?? 'Untitled project']]) : undefined,
    });

    // Tell the producer. Best-effort: the message is saved.
    const note = buildArtistMessageNotification({
      ownerId: portal.user_id,
      contactId: portal.contact_id,
      contactName: names.artistName,
      messageId: message.id,
      kind: message.kind,
      body: body.body,
      projectName,
    });
    const [nRes, aRes] = await Promise.all([
      admin.from('notifications').insert(note),
      admin.from('contact_activity').insert({
        contact_id: portal.contact_id,
        user_id: portal.user_id,
        kind: message.kind === 'request' ? 'artist_request' : 'artist_message',
        title: note.title,
        body: body.body.slice(0, 1000),
        metadata: { message_id: message.id, project_id: projectId },
      }),
    ]);
    if (nRes.error) log.warn('message notification failed', { error: errorMessage(nRes.error) });
    if (aRes.error) log.warn('message timeline row failed', { error: errorMessage(aRes.error) });

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ error: 'Messages are not available yet.' }, { status: 503 });
    log.error('portal message failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
