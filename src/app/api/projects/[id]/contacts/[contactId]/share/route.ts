import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ArtistNotifyBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { sendPortalDigest } from '@/lib/artists/portal-send';
import { isSchemaNotReady, schemaNotReadyResponse } from '@/lib/artists/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.contacts.share');

/**
 * POST /api/projects/[id]/contacts/[contactId]/share  { message? }
 *
 * "Share with <artist>": put the project in their portal (linking them first
 * if needed), create the portal if they have none, and send the invite — the
 * digest email, recorded as a send and a timeline event. From then on,
 * anything added to the project shows up in the same portal with no new link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  const parsed = await readBody(req, ArtistNotifyBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const { data: contact, error: cErr } = await admin
      .from('contacts')
      .select('id, name, email')
      .eq('id', contactId)
      .eq('user_id', userId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    if (!contact.email) return NextResponse.json({ error: 'This contact has no email address.' }, { status: 400 });

    const { data: existing, error: lErr } = await admin
      .from('project_contacts')
      .select('in_portal')
      .eq('project_id', id)
      .eq('contact_id', contactId)
      .eq('user_id', userId)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!existing) {
      const { error } = await admin.from('project_contacts').insert({ user_id: userId, project_id: id, contact_id: contactId, in_portal: true });
      if (error) throw error;
    } else if (!existing.in_portal) {
      // Re-entering the portal is news again: clear the watermark.
      const { error } = await admin.from('project_contacts').update({ in_portal: true, last_notified_at: null })
        .eq('project_id', id).eq('contact_id', contactId).eq('user_id', userId);
      if (error) throw error;
    }

    const result = await sendPortalDigest(admin, { userId, contact, message: parsed.data.message, force: true, focusProjectId: id });
    if (!result.ok) return NextResponse.json({ error: result.error, inPortal: true }, { status: result.status });
    return NextResponse.json({ ...result, inPortal: true });
  } catch (err) {
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('share failed', { id, contactId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
