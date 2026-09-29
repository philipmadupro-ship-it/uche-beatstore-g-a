import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ArtistMessageBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { portalUrl } from '@/lib/artists/portal-send';
import { loadThread, markRead, threadNames } from '@/lib/artist-messages/load';
import { ARTIST_MESSAGE_COLUMNS, buildMessageEmail, shouldEmailMessage, toArtistMessage, type MessageRow } from '@/lib/artist-messages/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.messages');
const NOT_READY = { error: 'Messages need migration 130 applied on Supabase.', migration: '130', schemaReady: false };

/**
 * GET  /api/contacts/[id]/messages[?read=1] — the thread with this artist,
 *      requests included. `read=1` (the Messages tab is open) stamps the
 *      artist's messages as seen.
 * POST /api/contacts/[id]/messages — { body, email? }. Saved to the thread
 *      the artist reads in their portal, and emailed as a fallback unless
 *      lib/artist-messages decides the artist will see it anyway (on the
 *      portal right now, or already emailed about an unread message).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, messages: [] });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;
  try {
    const thread = await loadThread(admin, { userId, contactId: id, audience: 'producer' });
    if (thread.schemaReady && req.nextUrl.searchParams.get('read') === '1') {
      const now = new Date().toISOString();
      const marked = await markRead(admin, { userId, contactId: id, author: 'artist', now });
      if (marked > 0) for (const m of thread.messages) if (m.author === 'artist' && !m.readAt) m.readAt = now;
    }
    return NextResponse.json(thread);
  } catch (err) {
    log.error('load failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Messages need Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;
  const parsed = await readBody(req, ArtistMessageBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    // Read first: PostgREST answers an insert into a missing table with an
    // empty 404 that isMissingSchema cannot recognise.
    const probe = await admin.from('artist_messages').select('id').limit(1);
    if (probe.error) {
      if (isMissingSchema(probe.error)) return NextResponse.json(NOT_READY, { status: 503 });
      throw probe.error;
    }

    const [contactRes, portalRes, unreadRes] = await Promise.all([
      admin.from('contacts').select('name, email').eq('id', id).eq('user_id', userId).maybeSingle(),
      admin.from('artist_portals').select('token, revoked_at, last_viewed_at').eq('contact_id', id).eq('user_id', userId).maybeSingle(),
      admin.from('artist_messages').select('emailed_at').eq('contact_id', id).eq('user_id', userId).eq('author', 'producer').is('read_at', null),
    ]);
    const contact = contactRes.data as { name: string | null; email: string | null } | null;
    const portal = portalRes.data as { token: string; revoked_at: string | null; last_viewed_at: string | null } | null;

    const { data, error } = await admin
      .from('artist_messages')
      .insert({ user_id: userId, contact_id: id, author: 'producer', kind: 'message', body: body.body })
      .select(ARTIST_MESSAGE_COLUMNS)
      .single();
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json(NOT_READY, { status: 503 });
      throw error;
    }
    const row = data as MessageRow;
    const now = new Date();

    const decision = body.email
      ? shouldEmailMessage({
          hasEmail: !!contact?.email,
          portalLive: !!portal && !portal.revoked_at,
          artistLastSeenAt: portal?.last_viewed_at ?? null,
          unreadEmailedAt: ((unreadRes.data ?? []) as Array<{ emailed_at: string | null }>).map((r) => r.emailed_at),
          now,
        })
      : ({ email: false, reason: 'off' } as const);

    const names = await threadNames(admin, userId, id);
    let emailed = false;
    let emailError: string | null = null;
    if (decision.email && process.env.RESEND_API_KEY) {
      const mail = buildMessageEmail({ ...names, portalUrl: portalUrl(portal!.token), body: body.body });
      const { error: sendErr } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: contact!.email!,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (sendErr) {
        emailError = sendErr.message || 'Email send failed';
        log.warn('message email failed', { id, error: emailError });
      } else {
        emailed = true;
        row.emailed_at = now.toISOString();
        const { error: stampErr } = await admin.from('artist_messages').update({ emailed_at: row.emailed_at }).eq('id', row.id).eq('user_id', userId);
        if (stampErr) log.warn('emailed_at stamp failed', { id, error: errorMessage(stampErr) });
      }
    } else if (decision.email) {
      emailError = 'Email sending is not configured.';
    }

    const { error: actErr } = await admin.from('contact_activity').insert({
      contact_id: id,
      user_id: userId,
      kind: 'producer_message',
      title: emailed ? 'You sent a message · emailed' : 'You sent a message',
      body: body.body.slice(0, 1000),
      metadata: { message_id: row.id, emailed },
      occurred_at: now.toISOString(),
    });
    if (actErr) log.warn('timeline row failed', { id, error: errorMessage(actErr) });

    return NextResponse.json({
      message: toArtistMessage(row, { audience: 'producer', ...names }),
      emailed,
      emailSkipped: decision.email ? null : decision.reason,
      emailError,
    }, { status: 201 });
  } catch (err) {
    log.error('send failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
