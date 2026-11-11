/**
 * Library tag facet — every tag, not just genre.
 *
 * The Filters menu only knew `genre`, so a track tagged "Ready to send" (a
 * `status` tag), "Dark" (mood) or "Piano" (instrument) could be tagged but never
 * found again. This is the one rule for the new Tags facet, used by the filter
 * predicate, the menu and the URL codec.
 *
 * Decisions worth keeping:
 * - **Match on the tag NAME, case-insensitively, never on the stored category.**
 *   The bulk tagger writes every tag with category `custom` and lower-cases what
 *   was typed, so "Ready to send" added in bulk is stored as `ready to send` /
 *   `custom`. Filtering on `category === 'status'` would silently miss it.
 * - **Any of a group, all of the groups.** Selecting Dark + Melodic (both mood)
 *   is "either vibe"; adding Ready to send (status) narrows that to the ones
 *   ready to go. The group of a tag comes from the shared taxonomy; a tag not in
 *   it belongs to `custom`.
 * - Genre keeps its own facet (it predates this and is stored in smart
 *   playlists and URLs), so genre tags are not offered here.
 *
 * Pure by design (CLAUDE.md: logic inside the component gets silently reverted).
 */

import { TAG_TAXONOMY } from '@/lib/types/tags';

export type TagFacetGroup = 'mood' | 'instruments' | 'status' | 'custom';

export const TAG_FACET_GROUPS: readonly TagFacetGroup[] = ['status', 'mood', 'instruments', 'custom'];

export const TAG_FACET_GROUP_LABELS: Record<TagFacetGroup, string> = {
  status: 'Status',
  mood: 'Mood',
  instruments: 'Instruments',
  custom: 'Your tags',
};

export interface TrackTagLike {
  tag: string;
  category?: string | null;
}

export const normalizeTag = (tag: string): string => tag.trim().toLowerCase();

const GENRES = new Set(TAG_TAXONOMY.genre.map(normalizeTag));

/** tag (normalised) -> its group, for the taxonomy's non-genre categories. */
const GROUP_OF = new Map<string, TagFacetGroup>();
for (const group of ['status', 'mood', 'instruments'] as const) {
  for (const t of TAG_TAXONOMY[group]) GROUP_OF.set(normalizeTag(t), group);
}

/** Which facet group a tag belongs to; anything outside the taxonomy is `custom`. */
export function tagGroupOf(tag: string): TagFacetGroup {
  return GROUP_OF.get(normalizeTag(tag)) ?? 'custom';
}

/**
 * Does a track's tag list satisfy the selected tags?
 * Empty selection passes everything. See the module comment for any/all.
 */
export function matchesTagFilter(
  trackTags: readonly TrackTagLike[] | null | undefined,
  selected: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  const have = new Set((trackTags ?? []).map((t) => normalizeTag(t.tag)));

  const wantedByGroup = new Map<TagFacetGroup, string[]>();
  for (const tag of selected) {
    const g = tagGroupOf(tag);
    const list = wantedByGroup.get(g) ?? [];
    list.push(normalizeTag(tag));
    wantedByGroup.set(g, list);
  }
  for (const wanted of wantedByGroup.values()) {
    if (!wanted.some((w) => have.has(w))) return false;
  }
  return true;
}

export interface TagFacetOption {
  /** The label to show and the value stored in the filter. */
  tag: string;
  /** How many loaded tracks carry it. */
  count: number;
}

export type TagFacetOptions = Record<TagFacetGroup, TagFacetOption[]>;

/**
 * What the Tags menu offers: the whole taxonomy (so a tag nobody has used yet is
 * still findable — and its zero count says so) plus every other tag actually on
 * a track, under "Your tags". Genres are excluded, they have their own facet.
 *
 * A tag typed in a different case from the taxonomy folds into the taxonomy
 * entry's count rather than showing twice.
 */
export function buildTagFacetOptions(
  tracks: ReadonlyArray<{ track_tags?: readonly TrackTagLike[] | null }>,
): TagFacetOptions {
  const counts = new Map<string, number>(); // normalised -> tracks carrying it
  const display = new Map<string, string>(); // normalised -> first-seen spelling
  for (const t of tracks) {
    const seen = new Set<string>();
    for (const tt of t.track_tags ?? []) {
      const key = normalizeTag(tt.tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!display.has(key)) display.set(key, tt.tag.trim());
    }
  }

  const out: TagFacetOptions = { status: [], mood: [], instruments: [], custom: [] };
  for (const group of ['status', 'mood', 'instruments'] as const) {
    for (const tag of TAG_TAXONOMY[group]) {
      out[group].push({ tag, count: counts.get(normalizeTag(tag)) ?? 0 });
    }
  }
  const taxonomy = new Set(GROUP_OF.keys());
  const customs = [...counts.keys()]
    .filter((k) => !taxonomy.has(k) && !GENRES.has(k))
    .sort((a, b) => a.localeCompare(b));
  for (const key of customs) {
    out.custom.push({ tag: display.get(key) ?? key, count: counts.get(key) ?? 0 });
  }
  return out;
}
