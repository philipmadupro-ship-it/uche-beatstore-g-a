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

const log = createLogger('api.contacts.notify');

/**
 * POST /api/contacts/[id]/notify  { message? }
 *
 * The "Notify · N new" button: one digest email of everything in the
 * artist's portal they have not been told about, pointing at the same
 * permanent link. 409 when there is nothing new — pressing it twice must not
 * send the same news twice.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  const parsed = await readBody(req, ArtistNotifyBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const { data: contact, error } = await admin
      .from('contacts')
      .select('id, name, email')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const result = await sendPortalDigest(admin, { userId, contact, message: parsed.data.message });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('notify failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
