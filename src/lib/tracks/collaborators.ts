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
