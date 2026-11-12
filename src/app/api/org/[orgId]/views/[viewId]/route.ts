/**
 * PATCH / DELETE /api/org/[orgId]/views/[viewId] (LABEL-37).
 *
 *   PATCH { name?, definition?, shared? }
 *         The author changes their own view (sharing it needs `catalog.write`;
 *         a changed definition is checked against the author's role again).
 *         An owner or admin can take someone else's SHARED view down
 *         (`{ shared: false }` only); nobody rewrites a view that is not theirs.
 *   DELETE  the author, or an owner / admin for a shared view.
 *
 * A personal view of somebody else is 404, never 403: it is not theirs to
 * know exists. Authorisation is by membership first (`catalog.read`), so a
 * non-member and an external project member are refused before any view is read.
 */
import { NextRequest } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody, isUUID } from '@/lib/validate';
import { OrgViewPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { parseDefinition, type Definition } from '@/lib/labelos/filters';
import { planChange, planDelete, type ViewPatch } from '@/lib/labelos/saved-views';
import { actorOf, json, notReady, presentViews, readApprovalsOf } from '@/lib/labelos/saved-views-route';
import { deleteView, readView, SavedViewsNotReadyError, updateView } from '@/lib/labelos/saved-views-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.views.item');

type Params = { params: Promise<{ orgId: string; viewId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, viewId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Saved views need Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  if (!isUUID(viewId)) return json(404, { error: 'Not found' });
  const body = await readBody(req, OrgViewPatchBodySchema);
  if (!body.ok) return body.res;

  let definition: Definition | undefined;
  if (body.data.definition !== undefined) {
    const parsed = parseDefinition(body.data.definition);
    if (!parsed.ok) return json(400, { error: parsed.error });
    definition = parsed.definition;
  }

  try {
    const row = await readView(access.admin, access.orgId, viewId);
    if (!row) return json(404, { error: 'Not found' });
    if (definition && definition.subject !== row.subject) return json(400, { error: 'A view keeps its subject' });
    const patch: ViewPatch = { name: body.data.name, definition, shared: body.data.shared };
    const plan = planChange(row, actorOf(access), patch, readApprovalsOf(access));
    if (!plan.ok) return json(plan.status, { error: plan.error });

    const changed: string[] = [];
    if (patch.name !== undefined && patch.name !== row.name) changed.push('name');
    if (patch.definition !== undefined) changed.push('definition');
    if (patch.shared !== undefined && patch.shared !== row.shared) changed.push('shared');
    if (changed.length === 0) {
      const shown = await presentViews(access, [row]);
      return json(200, { view: shown.views[0] ?? null, names: shown.names });
    }

    const res = await updateView(access.admin, access.orgId, viewId, { name: patch.name, definition: patch.definition, shared: patch.shared });
    if ('missing' in res) return json(404, { error: 'Not found' });
    if ('duplicate' in res) return json(409, { error: 'You already have a view with that name' });

    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'view.updated', { type: 'view', id: viewId }, { subject: row.subject, changed, shared: res.view.shared });

    const shown = await presentViews(access, [res.view]);
    return json(200, { view: shown.views[0] ?? null, names: shown.names });
  } catch (err) {
    if (err instanceof SavedViewsNotReadyError) return notReady();
    log.error('view update failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not change the view' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, viewId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Saved views need Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  if (!isUUID(viewId)) return json(404, { error: 'Not found' });
  try {
    const row = await readView(access.admin, access.orgId, viewId);
    if (!row) return json(404, { error: 'Not found' });
    const plan = planDelete(row, actorOf(access));
    if (!plan.ok) return json(plan.status, { error: plan.error });
    if (!(await deleteView(access.admin, access.orgId, viewId))) return json(404, { error: 'Not found' });
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'view.deleted', { type: 'view', id: viewId }, { subject: row.subject, shared: row.shared });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof SavedViewsNotReadyError) return notReady();
    log.error('view delete failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not delete the view' });
  }
}
