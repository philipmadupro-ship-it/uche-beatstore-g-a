import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody, isUUID } from '@/lib/validate';
import { ArtistRequestPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { threadNames } from '@/lib/artist-messages/load';
import { ARTIST_MESSAGE_COLUMNS, requestStatusPatch, toArtistMessage, type MessageRow } from '@/lib/artist-messages/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.messages.item');

const STATUS_WORD = { open: 'Reopened', done: 'Done', declined: 'Declined' } as const;

/**
 * PATCH /api/contacts/[id]/messages/[messageId] — { request_status }. Only an
 * artist's request has a status; the artist sees it change in their portal.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Messages need Supabase.' }, { status: 501 });
  if (!isUUID(messageId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;
  const parsed = await readBody(req, ArtistRequestPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from('artist_messages')
      .update(requestStatusPatch(parsed.data.request_status, now))
      .eq('id', messageId)
      .eq('contact_id', id)
      .eq('user_id', userId)
      .eq('kind', 'request')
      .select(ARTIST_MESSAGE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ error: 'Messages need migration 130 applied on Supabase.', migration: '130' }, { status: 503 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const row = data as MessageRow;

    const { error: actErr } = await admin.from('contact_activity').insert({
      contact_id: id,
      user_id: userId,
      kind: 'artist_request_resolved',
      title: `${STATUS_WORD[parsed.data.request_status]} · request`,
      body: row.body.slice(0, 280),
      metadata: { message_id: row.id, request_status: parsed.data.request_status },
      occurred_at: now,
    });
    if (actErr) log.warn('timeline row failed', { id, error: errorMessage(actErr) });

    const names = await threadNames(admin, userId, id);
    return NextResponse.json({ message: toArtistMessage(row, { audience: 'producer', ...names }) });
  } catch (err) {
    log.error('request update failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
