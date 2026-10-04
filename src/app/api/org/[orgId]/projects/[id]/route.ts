/**
 * GET /api/org/[orgId]/projects/[id] (LABEL-17) — one org project: its
 * artists and the songs the member sees. Its files are the existing
 * `…/projects/[id]/assets` routes (LABEL-15).
 *
 * requireObjectAccess on the PROJECT (row org, artist scope through its
 * inbox artist and project_contacts, `catalog.read`): 404 for a producer
 * project, another org's, one out of scope or missing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadOrgProject } from '@/lib/labelos/org-workspace-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.id');

type Params = { params: Promise<{ orgId: string; id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  try {
    const detail = await loadOrgProject(access);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('project load failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the project' }, { status: 500 });
  }
}
