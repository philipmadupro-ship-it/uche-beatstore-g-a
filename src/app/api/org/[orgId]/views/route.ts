/**
 * /api/org/[orgId]/views — saved filter views (LABEL-37, 08 §A3.5).
 *
 *   GET  ?subject=songs|releases   the views this member is shown: their own and
 *        the org's shared ones, each with its definition as THEY may see it
 *        (ids they cannot see dropped) and the names for its chips. A shared
 *        view that refers to anything outside their artist scope is not listed.
 *        `catalog.read`.
 *   POST { subject, name, definition, shared? }
 *        `catalog.read` saves a personal view; `shared: true` needs
 *        `catalog.write`. A definition that uses clauses the saver's role
 *        cannot read (credits, splits, legal approvals) is refused — the view
 *        would show them nothing.
 *
 * A view stores a DEFINITION only; results are recomputed per viewer on every
 * run (`/views/run`). Before migration 161 both answer `schemaReady: false`.
 */
import { NextRequest } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgViewCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { parseDefinition } from '@/lib/labelos/filters';
import { MAX_VIEWS_PER_AUTHOR, MAX_VIEWS_PER_ORG, planSave } from '@/lib/labelos/saved-views';
import { actorOf, json, notReady, presentViews, readApprovalsOf } from '@/lib/labelos/saved-views-route';
import { countViews, insertView, listViews, SavedViewsNotReadyError } from '@/lib/labelos/saved-views-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.views');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Saved views need Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  const subject = new URL(req.url).searchParams.get('subject');
  if (subject !== null && subject !== 'songs' && subject !== 'releases') return json(400, { error: 'Ask for songs or releases' });
  try {
    const rows = await listViews(access.admin, access.orgId, subject ?? undefined);
    const { views, names } = await presentViews(access, rows);
    return json(200, { schemaReady: true, views, names, canShare: access.capabilities.has('catalog.write') });
  } catch (err) {
    if (err instanceof SavedViewsNotReadyError) return json(200, { schemaReady: false, views: [], names: { artists: {}, parties: {}, projects: {} }, canShare: false });
    log.error('view list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the saved views' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Saved views need Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  const body = await readBody(req, OrgViewCreateBodySchema);
  if (!body.ok) return body.res;
  const { subject, name, shared = false } = body.data;

  const parsed = parseDefinition(body.data.definition);
  if (!parsed.ok) return json(400, { error: parsed.error });
  if (parsed.definition.subject !== subject) return json(400, { error: 'The definition is about a different kind of thing than the view' });

  const plan = planSave(actorOf(access), { shared, definition: parsed.definition }, readApprovalsOf(access));
  if (!plan.ok) return json(plan.status, { error: plan.error });

  try {
    const [mine, all] = await Promise.all([countViews(access.admin, access.orgId, access.userId), countViews(access.admin, access.orgId)]);
    if (mine >= MAX_VIEWS_PER_AUTHOR) return json(409, { error: `You can keep ${MAX_VIEWS_PER_AUTHOR} saved views; delete one first` });
    if (all >= MAX_VIEWS_PER_ORG) return json(409, { error: 'This organization has reached its limit of saved views' });

    const made = await insertView(access.admin, { org: access.orgId, author: access.userId, subject, name, definition: parsed.definition, shared });
    if ('duplicate' in made) return json(409, { error: 'You already have a view with that name' });

    // Everyday event, best effort. Never the name, never the filter: only what kind and who can run it.
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'view.created', { type: 'view', id: made.view.id }, { subject, shared });

    const shown = await presentViews(access, [made.view]);
    return json(201, { view: shown.views[0] ?? null, names: shown.names });
  } catch (err) {
    if (err instanceof SavedViewsNotReadyError) return notReady();
    log.error('view create failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the view' });
  }
}
