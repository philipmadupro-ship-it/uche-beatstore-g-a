/**
 * Pure helpers for rendering a track's collaborator credits.
 *
 * The write paths (`lib/upload/collaborators.ts`, the API route) own
 * persistence; this module only orders and labels rows for display, so the
 * ordering rule and the "what does `source` mean to a producer" copy live in
 * one tested place instead of being re-decided inside a component.
 */
import type { CollaboratorRole } from '@/lib/upload/title-metadata';

/** A credit as the API returns it — the full stored row. */
export interface TrackCollaborator {
  id: string;
  track_id: string;
  name: string;
  role: string;
  source: string;
  created_at: string;
  /** The CRM contact this credit is (mig 124). */
  contact_id?: string | null;
}

/**
 * The contact a credit most likely is: exactly one contact whose name matches
 * case- and space-insensitively. Two matches is a guess, so none is offered.
 */
export function suggestContactForCredit<T extends { id: string; name: string }>(creditName: string, contacts: readonly T[]): T | null {
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  const target = norm(creditName);
  if (!target) return null;
  const hits = contacts.filter((c) => norm(c.name) === target);
  return hits.length === 1 ? hits[0] : null;
}

/** Credits derived from a filename are never silently replaced — see migration 115. */
export const FILENAME_SOURCE = 'filename';
/** Everything the producer typed by hand, through this route. */
export const MANUAL_SOURCE = 'manual';

/** Display order: who made the beat, then who's on it, then everyone else. */
const ROLE_ORDER: Record<string, number> = {
  producer: 0,
  feature: 1,
  collaborator: 2,
};

/**
 * Stable sort by role (producer → feature → collaborator → anything else),
 * then alphabetically within a role, so re-fetching doesn't reshuffle a list
 * the producer is looking at.
 */
export function sortCollaborators<T extends { role: string; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? ROLE_ORDER.collaborator + 1;
    const rb = ROLE_ORDER[b.role] ?? ROLE_ORDER.collaborator + 1;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

/** True when this credit came from parsing the upload filename, not a producer typing it. */
export function isAutoDerived(source: string): boolean {
  return source === FILENAME_SOURCE;
}

const ROLE_LABELS: Record<string, string> = {
  producer: 'Producer',
  feature: 'Feature',
  collaborator: 'Collaborator',
};

/** Human label for a role. Unknown roles (a producer can type anything) pass through as-is. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export const KNOWN_COLLABORATOR_ROLES: readonly CollaboratorRole[] = ['producer', 'feature', 'collaborator'];

/** One person on a track: every credit they hold, their roles in display order. */
export interface CreditGroup<T extends TrackCollaborator = TrackCollaborator> {
  key: string;
  name: string;
  contactId: string | null;
  roles: string[];
  credits: T[];
  /** Any of their credits was read from the filename. */
  auto: boolean;
}

/**
 * Credits grouped by PERSON, so an artist credited as feature and writer (or
 * credited twice under slightly different spacing) is one entry, not two.
 * A linked contact is the identity; otherwise the name, case- and
 * space-insensitively. Groups keep `sortCollaborators` order (by their first
 * credit), and roles are listed in that order too.
 */
export function groupCredits<T extends TrackCollaborator>(rows: readonly T[]): CreditGroup<T>[] {
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  const groups = new Map<string, CreditGroup<T>>();
  // Name → the contact any credit of that name is linked to, so a linked and
  // an unlinked credit of the same person land together.
  const contactForName = new Map<string, string>();
  for (const r of rows) if (r.contact_id) contactForName.set(norm(r.name), r.contact_id);
  for (const r of sortCollaborators([...rows])) {
    const contactId = r.contact_id ?? contactForName.get(norm(r.name)) ?? null;
    const key = contactId ? `c:${contactId}` : `n:${norm(r.name)}`;
    const g = groups.get(key) ?? { key, name: r.name, contactId, roles: [], credits: [], auto: false };
    if (!g.roles.includes(r.role)) g.roles.push(r.role);
    g.credits.push(r);
    g.auto = g.auto || isAutoDerived(r.source);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** How many people a credit strip shows before "+N more". */
export const CREDITS_VISIBLE = 3;

/** The groups to draw and how many are folded away. Never folds away just one (show it instead). */
export function visibleCredits<T>(groups: readonly T[], expanded: boolean, limit = CREDITS_VISIBLE): { shown: T[]; hidden: number } {
  if (expanded || groups.length <= limit + 1) return { shown: [...groups], hidden: 0 };
  return { shown: groups.slice(0, limit), hidden: groups.length - limit };
}
