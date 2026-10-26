/**
 * GET /api/org/[orgId]/artists/[contactId]/workspace (LABEL-17) — one roster
 * artist's org workspace: their projects, songs, releases and what the
 * member may do (07 §2.2, 17 R12). The org twin of the producer's
 * `/api/contacts/[id]/workspace`, which is untouched.
 *
 * requireObjectAccess on the CONTACT reads its org from the row: a producer
 * contact, another org's, a missing id, a non-member and — for a member
 * limited to some artists — any other artist are all 404. Then
 * `catalog.read`, else 403. Songs a member may not hear as a row (working
 * material for marketing, D4) are counted, never listed
 * (lib/labelos/org-workspace-store).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadOrgArtistWorkspace } from '@/lib/labelos/org-workspace-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.artists.workspace');

type Params = { params: Promise<{ orgId: string; contactId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  try {
    const workspace = await loadOrgArtistWorkspace(access);
    if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ workspace }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('workspace load failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the workspace' }, { status: 500 });
  }
}
