/**
 * The artist roster (LABEL-10, 17-reconciliation R3): an org's artists are
 * its contacts in workspace mode (`isWorkspaceMode`, main #44) plus any
 * contact with an artist role (Q2, answered 2026-10-02: a label org keeps
 * its own contacts directory). Everyone else in the directory — producers,
 * engineers, press — is a contact but not on the roster.
 *
 * Until LABEL-12 gives projects an org, an org contact cannot be linked to a
 * project or hold a portal (the 122+ same-owner triggers refuse a contact
 * with no owner), so routes pass `NO_WORKSPACE` and the artist role decides.
 *
 * D1: an artist org's roster is the artist themselves — one contact,
 * created with the org (migration 139). The routes keep it that way.
 */
import { summarizeArtist, type ArtistSummary } from '@/lib/contacts/artist-summary';
import { isWorkspaceMode } from '@/lib/contacts/relationship';
import { groupOfCategory, type RoleInput } from '@/lib/contacts/roles';
import type { OrgKind } from './capabilities';

export type WorkspaceInput = { linkedProjects: number; hasPortal: boolean };

export const NO_WORKSPACE: WorkspaceInput = Object.freeze({ linkedProjects: 0, hasPortal: false });

function hasArtistRole(c: RoleInput): boolean {
  return groupOfCategory(c.category) === 'artist' || groupOfCategory(c.secondary_category) === 'artist';
}

export function isRosterContact(c: RoleInput, workspace: WorkspaceInput): boolean {
  return isWorkspaceMode(workspace) || hasArtistRole(c);
}

const ONE_ARTIST = 'An artist organization has exactly one artist: the artist themselves.';

/**
 * Would writing `candidate` (an edit when it carries an `id`, else a new
 * contact) leave an artist org with other than one roster artist?
 * `existing` is the org's current contacts. Null = fine.
 */
export function artistOrgRosterError(
  kind: OrgKind,
  existing: readonly (RoleInput & { id: string })[],
  candidate: RoleInput & { id?: string },
): string | null {
  if (kind !== 'artist') return null;
  const others = existing.filter((c) => c.id !== candidate.id && hasArtistRole(c));
  const was = candidate.id ? existing.find((c) => c.id === candidate.id) : undefined;
  if (hasArtistRole(candidate)) return others.length > 0 ? ONE_ARTIST : null;
  if (was && hasArtistRole(was) && others.length === 0) return ONE_ARTIST;
  return null;
}

/** Deleting the artist org's one artist is refused; anyone else may go. */
export function artistOrgRemovalError(kind: OrgKind, contact: RoleInput): string | null {
  return kind === 'artist' && hasArtistRole(contact) ? ONE_ARTIST : null;
}

/**
 * An org roster contact as the shared Artists card (`components/artists/
 * ArtistsCardView`) draws it, through the same `summarizeArtist` the
 * producer's /contacts uses. The org has no projects, portal, sends or
 * decisions yet (LABEL-12 onwards gives those tables an org), so the card
 * honestly reads "New" with nothing moving, rather than inventing activity.
 */
export function rosterSummary(c: { id: string; name: string; avatar_url: string | null; crm_status?: string | null }): ArtistSummary {
  return summarizeArtist({
    contact: { id: c.id, name: c.name, avatar_url: c.avatar_url, crm_status: c.crm_status ?? null },
    links: [],
    projects: [],
    portal: null,
    decisions: [],
    sends: [],
    activity: [],
    shareCount: 0,
    portalTracks: [],
    portalFiles: [],
  });
}
