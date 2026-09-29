/**
 * Did a Design autosave actually reach the database?
 *
 * `/api/profile` answered 200 with the profile for every Design autosave while
 * its field whitelist silently dropped `store_layout` (fixed in STORE-08). The
 * builder trusted the status code, said "saved", and no arrangement ever
 * reached `/store`. The route echoes the stored row, so the builder now checks
 * that the row it got back holds the layout it sent.
 *
 * Section ids in order are compared, not the whole JSON: Postgres `jsonb`
 * reorders object keys, so a byte comparison would report every good save as
 * failed. Arrays keep their order, and ids are unique per layout, so this is
 * exactly "the stored layout is this arrangement".
 */

import type { StoreLayout } from './layout';

type ResponseBody = { profile?: { store_layout?: unknown } | null } | null | undefined;

function sectionIds(layout: unknown): string[] | null {
  if (!layout || typeof layout !== 'object') return null;
  const sections = (layout as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return null;
  return sections.map((s) => (s && typeof s === 'object' ? String((s as { id?: unknown }).id ?? '') : ''));
}

/** Null when the saved row holds `sent`; otherwise a message for the producer. */
export function layoutSaveProblem(sent: StoreLayout, body: ResponseBody): string | null {
  const profile = body?.profile;
  // An older server that returns no profile at all proves nothing either way.
  if (!profile || typeof profile !== 'object') return null;
  const stored = sectionIds(profile.store_layout);
  const expected = sectionIds(sent) ?? [];
  if (stored && stored.length === expected.length && stored.every((id, i) => id === expected[i])) return null;
  return 'The server accepted the save but did not store the layout, so /store will not show it.';
}
