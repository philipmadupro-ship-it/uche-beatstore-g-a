/**
 * Which tags steer a generated cover, and in what order.
 *
 * The gradient leads on the first entry, so the order is the whole point:
 * genre first, then mood. Genre is the axis a producer browses by and the one
 * a buyer recognises, so a catalogue seeded this way groups by sound on sight.
 *
 * Instrument and status tags are excluded. They are dashboard bookkeeping —
 * "808s", "needs mix" — and letting them lead would colour two unrelated beats
 * identically because both happen to have a piano in them.
 *
 * Shared rather than re-derived per component because the same track must
 * produce the same artwork in the library, on the links page and on the
 * storefront. Four copies of this filter is four chances for one of them to
 * drift and for a beat to look like a different beat to a buyer.
 */
export interface TagRow {
  tag: string;
  category?: string | null;
}

export function artworkTagsOf(rows: readonly TagRow[] | null | undefined): string[] {
  if (!rows || rows.length === 0) return [];
  const genre: string[] = [];
  const mood: string[] = [];
  for (const row of rows) {
    if (!row?.tag) continue;
    if (row.category === 'genre') genre.push(row.tag);
    else if (row.category === 'mood') mood.push(row.tag);
  }
  return [...genre, ...mood];
}
