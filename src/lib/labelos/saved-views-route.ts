/**
 * What the saved-view routes share (LABEL-37): turning stored rows into what
 * ONE viewer is shown. Not a route itself; the rules are `saved-views.ts` and
 * `filters.ts`, the reads `saved-views-store.ts` and `filters-store.ts`.
 */
import { NextResponse } from 'next/server';
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { mayReadApprovals } from './approvals-route';
import { mentionedIds, parseDefinition, sanitizeDefinition, type Definition, type NameLookup } from './filters';
import { namesFor, visibleIdsFor } from './filters-store';
import { memberIdentities, memberLabel, type IdentityAdmin } from './member-identity';
import { hiddenFrom, orderViews, toViewDto, type ViewActor, type ViewDto, type ViewRow } from './saved-views';
import { SavedViewsNotReadyError } from './saved-views-store';

const NO_STORE = { 'Cache-Control': 'no-store' };
export const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export const notReady = () => json(503, { error: new SavedViewsNotReadyError().message, schemaReady: false });

export const actorOf = (access: OrgAccessOk): ViewActor => ({ userId: access.userId, role: access.role, capabilities: access.capabilities });
export const readApprovalsOf = (access: OrgAccessOk): boolean => mayReadApprovals(access.capabilities);

/** Names as plain objects, for JSON; the client turns them back into the lookup the chips use. */
export type NamesJson = { artists: Record<string, string>; parties: Record<string, string>; projects: Record<string, string> };
const obj = (m: ReadonlyMap<string, string>): Record<string, string> => Object.fromEntries(m);
export const namesJson = (n: NameLookup): NamesJson => ({ artists: obj(n.artists), parties: obj(n.parties), projects: obj(n.projects) });

/** A stored definition, or null when it no longer parses (an older version, a corrupt row). */
export function storedDefinition(row: ViewRow): Definition | null {
  const parsed = parseDefinition(row.definition);
  return parsed.ok && parsed.definition.subject === row.subject ? parsed.definition : null;
}

/**
 * The views this viewer is shown, in order, with the names their definitions
 * need resolved for THIS viewer. A shared view that refers to anything outside
 * their reach is left out; a definition is shown with unseen ids dropped.
 */
export async function presentViews(access: OrgAccessOk, rows: readonly ViewRow[]): Promise<{ views: ViewDto[]; names: NamesJson }> {
  const actor = actorOf(access);
  const visible = await visibleIdsFor(access);
  const shown: { row: ViewRow; definition: Definition; narrowed: boolean }[] = [];
  for (const row of rows) {
    const def = storedDefinition(row);
    if (!def) continue;
    const seen = sanitizeDefinition(def, visible);
    if (hiddenFrom(row, actor, seen.narrowed)) continue;
    shown.push({ row, definition: seen.definition, narrowed: seen.narrowed });
  }
  const others = [...new Set(shown.filter((s) => s.row.created_by.toLowerCase() !== actor.userId.toLowerCase()).map((s) => s.row.created_by.toLowerCase()))];
  const identities = others.length ? await memberIdentities(access.admin as unknown as IdentityAdmin, access.orgId, others, { withEmail: false }) : new Map();
  const wanted = { artists: new Set<string>(), parties: new Set<string>(), projects: new Set<string>() };
  for (const s of shown) {
    const m = mentionedIds(s.definition);
    m.artists.forEach((i) => wanted.artists.add(i));
    m.parties.forEach((i) => wanted.parties.add(i));
    m.projects.forEach((i) => wanted.projects.add(i));
  }
  const names = await namesFor(access, { artists: [...wanted.artists], parties: [...wanted.parties], projects: [...wanted.projects] }, visible);
  const views = orderViews(
    shown.map((s) => toViewDto(s.row, actor, { definition: s.definition, narrowed: s.narrowed }, memberLabel(identities.get(s.row.created_by.toLowerCase())))),
  );
  return { views, names: namesJson(names) };
}
