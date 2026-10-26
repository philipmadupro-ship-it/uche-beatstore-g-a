/**
 * GET /api/org/[orgId]/views/run (LABEL-37) — run a filter for THIS member.
 *
 *   ?view=<id>                  a saved view (their own, or a shared one they are shown)
 *   ?f=<encoded definition>     an ad-hoc filter (`encodeDefinition`; what the page keeps in the URL)
 *   &offset=&limit=             paging (100 by default, 200 at most)
 *
 * Whatever the definition says, the rows are the viewer's own: their artist
 * scope and D4 are applied before a row can match (`filters-store`), clauses
 * their role cannot read answer NO rows plus `unavailable`, and nothing in the
 * answer counts or hints at rows they cannot see. The definition handed back
 * has the ids they may not see dropped, with the names for their chips.
 *
 * Read-only, so it records no event.
 */
import { NextRequest } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { decodeDefinition, mentionedIds, sanitizeDefinition, type Definition } from '@/lib/labelos/filters';
import { FilterTooBroadError, namesFor, runDefinition, visibleIdsFor } from '@/lib/labelos/filters-store';
import { hiddenFrom } from '@/lib/labelos/saved-views';
import { actorOf, json, namesJson, notReady, storedDefinition } from '@/lib/labelos/saved-views-route';
import { readView, SavedViewsNotReadyError } from '@/lib/labelos/saved-views-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.views.run');

type Params = { params: Promise<{ orgId: string }> };

const intParam = (v: string | null): number | undefined => (v !== null && /^\d{1,6}$/.test(v) ? Number(v) : undefined);

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Filters need Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;

  const q = new URL(req.url).searchParams;
  const viewId = q.get('view');
  const encoded = q.get('f');
  if ((viewId === null) === (encoded === null)) return json(400, { error: 'Ask for a view or a filter' });

  try {
    const visible = await visibleIdsFor(access);
    let definition: Definition;
    let viewMeta: { id: string; name: string; shared: boolean } | null = null;
    if (viewId !== null) {
      const row = isUUID(viewId) ? await readView(access.admin, access.orgId, viewId) : null;
      const def = row ? storedDefinition(row) : null;
      if (!row || !def) return json(404, { error: 'Not found' });
      const seen = sanitizeDefinition(def, visible);
      // Not theirs, or it names things beyond their reach: it does not exist for them.
      if (hiddenFrom(row, actorOf(access), seen.narrowed)) return json(404, { error: 'Not found' });
      definition = def;
      viewMeta = { id: row.id, name: row.name, shared: row.shared };
    } else {
      const parsed = decodeDefinition(encoded);
      if (!parsed.ok) return json(400, { error: parsed.error });
      definition = parsed.definition;
    }

    // Run the ORIGINAL definition: an id the viewer cannot see matches nothing of theirs; dropping it would widen the result.
    const result = await runDefinition(access, definition, { limit: intParam(q.get('limit')), offset: intParam(q.get('offset')) });
    const shown = sanitizeDefinition(definition, visible);
    const m = mentionedIds(shown.definition);
    const names = await namesFor(access, m, visible);
    return json(200, { result, definition: shown.definition, narrowed: shown.narrowed, names: namesJson(names), view: viewMeta });
  } catch (err) {
    if (err instanceof SavedViewsNotReadyError) return notReady();
    if (err instanceof FilterTooBroadError) return json(422, { error: err.message });
    log.error('filter run failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not run the filter' });
  }
}
