/**
 * GET /api/org/[orgId]/projects/[id] (LABEL-17, LABEL-21) — one org project.
 *
 * An org member (requireObjectAccess on the PROJECT: row org, artist scope
 * through its inbox artist and project_contacts, `catalog.read`) gets the
 * workspace view: its artists and the songs they see. Its files are the
 * existing `…/projects/[id]/assets` routes (LABEL-15). 404 for a producer
 * project, another org's, one out of scope or missing.
 *
 * An EXTERNAL project member (LABEL-21, 06 §2.6) — someone admitted to this
 * one project through `project_members`, not an org member — gets the shared
 * view instead (lib/labelos/shared-project): the project, its songs and
 * recordings, the artist's name and what their role may do, and nothing the
 * org view carries (no artist ids, no stages, no files). Anything that is not
 * a live membership of THIS project is the same 404 a stranger gets.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireProjectActor } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadOrgProject } from '@/lib/labelos/org-workspace-store';
import { loadSharedProject } from '@/lib/labelos/shared-project-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.id');

type Params = { params: Promise<{ orgId: string; id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  const actor = await requireProjectActor({ projectId: id, orgId, cap: 'catalog.read' });
  if (!actor.ok) return actor.res;
  try {
    if (actor.kind === 'external') {
      const shared = await loadSharedProject(actor.access, id);
      if (!shared) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ shared }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const detail = await loadOrgProject(actor.access);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('project load failed', { orgId: actor.access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the project' }, { status: 500 });
  }
}
