/**
 * Artist scope (06-permission-model.md §2.5, LABEL-10): which roster
 * artists — org contacts, 17 R3 — a member sees. Pure, shared by
 * `src/lib/auth/org-access.ts` (requireObjectAccess, scopedOrgQuery) and its
 * SQL twin `public.can_see_artist` (migration 139):
 *
 *  - `org_members.scope = 'org'` (never role `artist`): the whole org.
 *  - otherwise only the contacts in `member_artist_scopes`. Role `artist` is
 *    scoped by role whatever the column says, and an unknown scope value
 *    reads as the narrowest. An object with no contact is not visible, and
 *    a scoped member with zero contacts sees nothing.
 *
 * A scope is `null` (whole org) or the set of visible contact ids,
 * lower-cased (uuids compare case-insensitively; Postgres returns them
 * lower-case).
 */
import { isUUID } from '@/lib/validate';

export type ArtistScope = ReadonlySet<string> | null;

export function toArtistScope(role: string, scopeColumn: string, contactIds: readonly (string | null | undefined)[]): ArtistScope {
  if (scopeColumn === 'org' && role !== 'artist') return null;
  const ids = new Set<string>();
  for (const id of contactIds) if (typeof id === 'string' && isUUID(id)) ids.add(id.toLowerCase());
  return ids;
}

export function scopeAllowsContact(scope: ArtistScope, contactId: string | null): boolean {
  if (scope === null) return true;
  return contactId !== null && scope.has(contactId.toLowerCase());
}

/** How a list read of a table must be narrowed for this scope. */
export type ArtistScopeFilter =
  | { kind: 'all' }
  | { kind: 'in'; column: string; values: string[] }
  | { kind: 'none' };

/**
 * `contactColumn` is the table's roster-contact column (ORG_OBJECT_TABLES),
 * or null when its rows carry none — those are org-level objects a scoped
 * member does not see.
 */
export function artistScopeFilter(scope: ArtistScope, contactColumn: string | null): ArtistScopeFilter {
  if (scope === null) return { kind: 'all' };
  if (!contactColumn || scope.size === 0) return { kind: 'none' };
  return { kind: 'in', column: contactColumn, values: [...scope].sort() };
}
