import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectContactPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isSchemaNotReady, schemaNotReadyResponse } from '@/lib/artists/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.contacts.detail');

const COLUMNS = 'contact_id, role, in_portal, allow_downloads, can_comment, last_notified_at, created_at';

/** PATCH — role and portal permissions for one linked contact. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;
  const parsed = await readBody(req, ProjectContactPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  const patch = { ...parsed.data };
  if (patch.pitch_note !== undefined) patch.pitch_note = patch.pitch_note?.trim() ? patch.pitch_note.trim() : null;

  try {
    const { data, error } = await auth.admin
      .from('project_contacts')
      .update(patch)
      .eq('project_id', id)
      .eq('contact_id', contactId)
      .eq('user_id', auth.userId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not linked' }, { status: 404 });
    return NextResponse.json({ link: data });
  } catch (err) {
    if (patch.pitch_note !== undefined && isSchemaNotReady(err)) {
      return NextResponse.json({ error: 'Pitch notes need migration 135 applied on Supabase.', migration: '135', schemaReady: false }, { status: 503 });
    }
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('PATCH failed', { id, contactId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/** DELETE — unlink. The project leaves the artist's portal; decisions stay. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;

  try {
    const { error } = await auth.admin
      .from('project_contacts')
      .delete()
      .eq('project_id', id)
      .eq('contact_id', contactId)
      .eq('user_id', auth.userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('DELETE failed', { id, contactId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
