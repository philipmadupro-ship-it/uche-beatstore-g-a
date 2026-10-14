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

/**
 * An object that reaches its roster artists through projects (a project:
 * its inbox artist and linked contacts; a track: those of every project of
 * its org it sits in — lib/labelos/org-read, LABEL-12) is visible when ANY
 * of them is in scope. The SQL twins are `can_see_org_project` /
 * `can_see_org_track` (migration 141).
 */
export function scopeAllowsAnyContact(scope: ArtistScope, contactIds: readonly string[]): boolean {
  if (scope === null) return true;
  return contactIds.some((id) => scopeAllowsContact(scope, id));
}

/**
 * May `viewer` see `member` in a list of the org's people? An artist's login
 * is that artist's name and their existence, so it follows the artist's
 * contact (`member_artist_scopes`): another artist never sees it, staff limited
 * to some artists see only the logins of those artists, everyone else sees
 * all. Staff and owners are always listed. `memberContactIds` is the artist
 * login's own roster list.
 */
export function mayListMember(
  viewer: { userId: string; role: string; scope: ArtistScope },
  member: { userId: string; role: string },
  memberContactIds: readonly string[],
): boolean {
  if (member.role !== 'artist') return true;
  if (member.userId.toLowerCase() === viewer.userId.toLowerCase()) return true;
  if (viewer.role === 'artist') return false;
  if (viewer.scope === null) return true;
  return memberContactIds.some((id) => viewer.scope!.has(id.toLowerCase()));
}

