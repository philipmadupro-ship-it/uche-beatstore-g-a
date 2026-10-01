/**
 * /contacts shows two audiences apart: ARTISTS (contacts in workspace mode —
 * linked to a project or holding a portal, `isWorkspaceMode`) and everyone
 * else (buyers, leads, industry). The server decides who is an artist
 * (`/api/contacts/artists`); this splits the CRM list by those ids so the
 * table, its stats and its filters count only the other contacts, and each
 * artist appears in exactly one place.
 */

import type { ArtistSummary } from './artist-summary';
import { RELATIONSHIP_META } from './relationship';

export function splitContacts<T extends { id: string }>(contacts: readonly T[], artistIds: ReadonlySet<string>): { artists: T[]; others: T[] } {
  const artists: T[] = [];
  const others: T[] = [];
  for (const c of contacts) (artistIds.has(c.id) ? artists : others).push(c);
  return { artists, others };
}

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Artists matching every word of `query` in their name, a linked project's
 * name, or their relationship stage ("working", "interested"). Order kept.
 */
export function searchArtists(artists: readonly ArtistSummary[], query: string): ArtistSummary[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...artists];
  return artists.filter((a) => {
    const hay = fold([a.contact.name, ...(a.projectNames ?? []), RELATIONSHIP_META[a.relationship.stage]?.label ?? ''].join(' '));
    return words.every((w) => hay.includes(w));
  });
}
