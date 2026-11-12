/**
 * The rules of saved views (LABEL-37). Pure: who may save, share, change,
 * delete and run a view, and how a stored row becomes what a viewer is shown.
 * The reads and writes are `saved-views-store.ts`, the routes are
 * `/api/org/[orgId]/views`.
 *
 * A view is a DEFINITION (lib/labelos/filters.ts) — ids and enums, never
 * results. Everything a viewer is shown of one is computed for THAT viewer:
 *
 *  - results are recomputed on every run (scope and D4 applied, filters-store);
 *  - the definition is shown with the ids they may not see dropped
 *    (`sanitizeDefinition`);
 *  - and a SHARED view whose definition refers to anything outside their reach
 *    is not listed to them at all (`hiddenFrom`): a view called "Nova demos"
 *    would name Nova to a member who may not know Nova exists, and the
 *    definition is not the only place a name can leak.
 *
 * Capabilities: a personal view needs `catalog.read` (the data's own
 * capability); making one visible to the org needs `catalog.write`. Only the
 * author edits a view; an owner or admin may take down (delete, or turn back
 * to personal) a SHARED view of someone else, and never sees a personal one.
 */
import { isOwnerOrAdmin } from './approvals';
import { DIMENSION_LABEL, unavailableDimensions, type Definition, type Subject } from './filters';

export const VIEW_NAME_MAX = 80;
export const MAX_VIEWS_PER_AUTHOR = 50;
export const MAX_VIEWS_PER_ORG = 500;

export type ViewRow = {
  id: string;
  org_id: string;
  created_by: string;
  subject: Subject;
  name: string;
  definition: unknown;
  shared: boolean;
  created_at: string;
  updated_at: string;
};

export const VIEW_COLUMNS = 'id, org_id, created_by, subject, name, definition, shared, created_at, updated_at';

export type ViewActor = { userId: string; role: string; capabilities: ReadonlySet<string> };

export type Plan = { ok: true } | { ok: false; status: 400 | 403 | 404 | 409; error: string };
const no = (status: 400 | 403 | 404 | 409, error: string): Plan => ({ ok: false, status, error });

const isAuthor = (row: Pick<ViewRow, 'created_by'>, actor: ViewActor): boolean => row.created_by.toLowerCase() === actor.userId.toLowerCase();

/** Can the actor use the clauses this definition has? A view they could not run is not worth saving. */
function dimensionsPlan(def: Definition, actor: ViewActor, readApprovals: boolean): Plan {
  const missing = unavailableDimensions(def, actor.capabilities, readApprovals);
  if (missing.length === 0) return { ok: true };
  return no(403, `Your role cannot read ${missing.map((d) => DIMENSION_LABEL[d]).join(' or ')}, so a view that filters on ${missing.length > 1 ? 'them' : 'it'} would show you nothing.`);
}

/** Saving a new view. */
export function planSave(actor: ViewActor, input: { shared: boolean; definition: Definition }, readApprovals: boolean): Plan {
  if (input.shared && !actor.capabilities.has('catalog.write')) return no(403, 'Sharing a view with the organization needs permission to edit the catalogue');
  return dimensionsPlan(input.definition, actor, readApprovals);
}

export type ViewPatch = { name?: string; definition?: Definition; shared?: boolean };

/** Whether the actor may know the row exists at all: their own, or someone's shared one. */
export const canSee = (row: ViewRow, actor: ViewActor): boolean => isAuthor(row, actor) || row.shared;

/** Changing a view. A row the actor may not know of is a 404, never a 403. */
export function planChange(row: ViewRow, actor: ViewActor, patch: ViewPatch, readApprovals: boolean): Plan {
  if (!canSee(row, actor)) return no(404, 'Not found');
  if (isAuthor(row, actor)) {
    if (patch.shared === true && !actor.capabilities.has('catalog.write')) return no(403, 'Sharing a view with the organization needs permission to edit the catalogue');
    if (patch.definition) return dimensionsPlan(patch.definition, actor, readApprovals);
    return { ok: true };
  }
  // Somebody else's shared view: an owner or admin can take it down, nobody can rewrite it.
  if (isOwnerOrAdmin(actor.role) && patch.shared === false && patch.name === undefined && patch.definition === undefined) return { ok: true };
  return no(403, 'Only the author can change this view');
}

/** Deleting a view. */
export function planDelete(row: ViewRow, actor: ViewActor): Plan {
  if (!canSee(row, actor)) return no(404, 'Not found');
  if (isAuthor(row, actor) || isOwnerOrAdmin(actor.role)) return { ok: true };
  return no(403, 'Only the author, an owner or an admin can delete this view');
}

/** Is a view out of the viewer's sight? Decided on the definition AFTER `sanitizeDefinition` said whether it narrowed. */
export function hiddenFrom(row: ViewRow, actor: ViewActor, narrowed: boolean): boolean {
  if (isAuthor(row, actor)) return false;
  return !row.shared || narrowed;
}

export type ViewDto = {
  id: string;
  subject: Subject;
  name: string;
  shared: boolean;
  /** The viewer wrote it. */
  mine: boolean;
  /** Who wrote a view that is not the viewer's (a display name, never an email). */
  author: string | null;
  definition: Definition;
  /** Part of the definition was left out because this viewer may not see it. Never says what. */
  narrowed: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Take down someone else's shared view (owner / admin). */
  canUnshare: boolean;
  updatedAt: string;
};

export function toViewDto(
  row: ViewRow,
  actor: ViewActor,
  shown: { definition: Definition; narrowed: boolean },
  authorName: string | null,
): ViewDto {
  const mine = isAuthor(row, actor);
  return {
    id: row.id,
    subject: row.subject,
    name: row.name,
    shared: row.shared,
    mine,
    author: mine ? null : authorName,
    definition: shown.definition,
    narrowed: shown.narrowed,
    canEdit: mine,
    canDelete: mine || (isOwnerOrAdmin(actor.role) && row.shared),
    canUnshare: !mine && isOwnerOrAdmin(actor.role) && row.shared,
    updatedAt: row.updated_at,
  };
}

/** Mine first, then others', each by name — the order the menu lists them in. */
export function orderViews<T extends { mine: boolean; name: string; id: string }>(views: readonly T[]): T[] {
  return [...views].sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
