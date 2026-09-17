import { TAG_TAXONOMY } from '@/lib/types/tags';

/**
 * The producer's own tag vocabulary.
 *
 * `TAG_TAXONOMY` is a fixed list shipped in the source. It was also, for a
 * long time, the ONLY thing the Tag Workspace could offer — so a custom tag
 * the producer typed in was written to `track_tags` correctly and then had
 * nowhere to live in the UI. It rendered in that one track's "Applied" row and
 * nowhere else: remove it and it was gone for good, and it was never offered
 * on any other track. From the producer's side that reads as "the tags I
 * create don't stay in the tag workspace", which is exactly right — they were
 * saved, they just weren't part of the vocabulary.
 *
 * This module turns the tags already present across the catalogue back into a
 * vocabulary. Pure on purpose: merging, case-folding and ranking is the kind
 * of logic that looks obvious inline in a component and silently rots.
 */

/** A tag as it is stored — one row per (track, tag). */
export interface TagUsageRow {
  tag: string;
  category?: string | null;
}

export interface VocabularyTag {
  /** The tag exactly as the producer first wrote it. */
  tag: string;
  category: string;
  /** How many tracks carry it. */
  count: number;
}

/** Every tag name the shipped taxonomy already covers, case-folded. */
const TAXONOMY_KEYS = new Set(
  Object.values(TAG_TAXONOMY).flatMap((options) =>
    (options as readonly string[]).map((t) => t.trim().toLowerCase()),
  ),
);

/** Same normalisation the tag-colours table uses, so the two agree on identity. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

export function isTaxonomyTag(tag: string): boolean {
  return TAXONOMY_KEYS.has(tagKey(tag));
}

/**
 * Collapse raw `track_tags` rows into the producer's CUSTOM vocabulary —
 * everything they've actually used that the shipped taxonomy doesn't already
 * render as a chip.
 *
 * Case-insensitive: "drill" and "Drill" are one tag, because the producer
 * thinks of them as one and `tag_colors` (mig 107) already keys them that way.
 * The first spelling seen wins, so the chip reads the way it was typed rather
 * than being lower-cased into something they never wrote.
 */
export function customVocabulary(rows: TagUsageRow[]): VocabularyTag[] {
  // Category is tracked as nullable INSIDE the fold and only defaulted on the
  // way out. Defaulting to 'custom' up front makes the placeholder look like a
  // real category, so a later row carrying the true one can never replace it.
  const byKey = new Map<string, { tag: string; category: string | null; count: number }>();

  for (const row of rows) {
    if (typeof row?.tag !== 'string') continue;
    const tag = row.tag.trim();
    if (!tag) continue;
    if (isTaxonomyTag(tag)) continue;

    const key = tagKey(tag);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      // Keep the richest category we've seen; rows written before a category
      // existed store null and shouldn't overwrite a real one.
      if (!existing.category && row.category) existing.category = row.category;
    } else {
      byKey.set(key, { tag, category: row.category ?? null, count: 1 });
    }
  }

  // Most-used first — the tag applied to 40 tracks is the one being reached
  // for again. Alphabetical within a count so the order is stable between
  // renders instead of drifting with row order from the database.
  return [...byKey.values()]
    .map(({ tag, category, count }) => ({ tag, category: category ?? 'custom', count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The vocabulary plus any tag applied to the track being edited.
 *
 * Without this a brand-new custom tag would vanish from the chip list the
 * moment it was removed from its only track — the same disappearing act this
 * module exists to fix, just one step later.
 */
export function vocabularyWithApplied(
  vocabulary: VocabularyTag[],
  appliedTags: string[],
): VocabularyTag[] {
  const seen = new Set(vocabulary.map((v) => tagKey(v.tag)));
  const extra: VocabularyTag[] = [];

  for (const tag of appliedTags) {
    const trimmed = typeof tag === 'string' ? tag.trim() : '';
    if (!trimmed || isTaxonomyTag(trimmed)) continue;
    const key = tagKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({ tag: trimmed, category: 'custom', count: 1 });
  }

  return [...vocabulary, ...extra.sort((a, b) => a.tag.localeCompare(b.tag))];
}
