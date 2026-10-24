/**
 * GET /api/org/[orgId]/projects (LABEL-50) — the org's projects by name, for
 * the one place that needs to choose one: inviting a collaborator to a
 * project as an external member (the Team page). Capability `share.external`
 * (the same one `POST …/projects/[id]/members` needs) and a member who sees
 * the whole organization — a limited member reaches projects through their
 * artists, and this list is not a way around that. Names and ids only.
 */
import { NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { pageAll } from '@/lib/labelos/paged-read';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects');

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'share.external');
  if (!access.ok) return access.res;
  if (access.artistScope !== null) {
    return NextResponse.json({ error: 'Only members who see the whole organization can list its projects.' }, { status: 403 });
  }
  try {
    const rows = await pageAll<{ id: string; name: string | null }>(
      (from, to) => access.admin.from('projects').select('id, name').eq('org_id', access.orgId).order('name', { ascending: true }).order('id').range(from, to),
      'project list',
    );
    return NextResponse.json(
      { projects: rows.map((p) => ({ id: p.id, name: p.name ?? 'Untitled project' })) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('list org projects failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not list the projects' }, { status: 500 });
  }
}
