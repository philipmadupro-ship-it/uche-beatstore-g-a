import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { loadWorkspace } from '@/lib/artists/workspace-load';
import { isSchemaNotReady } from '@/lib/artists/http';
import { portalUrl } from '@/lib/artists/portal-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.workspace');

/**
 * GET /api/contacts/[id]/workspace
 *
 * Everything the artist workspace renders, in one owner-filtered call:
 * linked projects (with portal permissions), every beat connected to the
 * artist with its decision and derived engagement, their songs with the beat
 * each is built on, the relationship stage, the portal and the Notify count.
 *
 * Before migrations 122–126 are applied it answers 200 with
 * `schemaReady: false`, and the contact page stays the CRM view.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Local-store mode (no Supabase): the workspace tables do not exist there.
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, workspaceMode: false });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    const { data: contact, error } = await admin
      .from('contacts')
      .select('id, name, crm_status')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const workspace = await loadWorkspace(admin, userId, contact);
    return NextResponse.json({
      schemaReady: true,
      ...workspace,
      portal: workspace.portal ? { ...workspace.portal, url: portalUrl(workspace.portal.token) } : null,
    });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ schemaReady: false, workspaceMode: false });
    log.error('workspace load failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
