/**
 * Attach `contact_tags` rows to their contacts as `tags: [{ tag, category }]`.
 *
 * Shared by `/api/contacts` and the server-rendered /contacts page. The page
 * used to skip it (`select('*')` returns no tags), and the list only refetches
 * from the API after an error — so every normal load showed no tags and an
 * empty tag filter, which read as "tags don't work".
 */
export interface ContactTagRowLike {
  contact_id: string;
  tag: string;
  category?: string | null;
}

export function attachContactTags<T extends { id: string }>(
  contacts: T[],
  tagRows: ReadonlyArray<ContactTagRowLike>,
): Array<T & { tags: { tag: string; category: string | null }[] }> {
  const byContact = new Map<string, { tag: string; category: string | null }[]>();
  for (const r of tagRows) {
    const arr = byContact.get(r.contact_id) ?? [];
    arr.push({ tag: r.tag, category: r.category ?? null });
    byContact.set(r.contact_id, arr);
  }
  return contacts.map((c) => ({ ...c, tags: byContact.get(c.id) ?? [] }));
}
