import { normalizeKey } from '@/lib/audio/key-normalize';

/**
 * Pure search / filter / sort for the track list on share pages.
 *
 * Same rule as `lib/store/filters.ts` and `lib/projects/filters.ts`: the logic
 * lives here, tested, and the component only renders what this returns. It is
 * its own function rather than a call into `filterAndSortTracks` because a
 * share is not a store: there is no price, favourite or "new this week", the
 * default order is the producer's own arrangement of the share (the store's
 * `featured` comparator reads `store_sort_order`, which a share row does not
 * carry), and a BPM range here means "has a tempo in this range". The key
 * comparison is the same `normalizeKey` the store uses, so `Bb` and `A#` are
 * one key in both places.
 */

export interface ShareListTag {
  tag: string;
  category?: string | null;
}

export interface ShareListTrack {
  id: string;
  title: string;
  type?: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  created_at?: string | null;
  tags?: ShareListTag[] | null;
}

export type ShareSort = 'share' | 'newest' | 'bpm-asc' | 'bpm-desc' | 'title';

export interface ShareListFilters {
  search: string;
  genre: string;
  mood: string;
  /** A key label as `shareKeyLabel` writes it ("F#m", "C"). */
  key: string;
  type: string;
  bpmMin: number | null;
  bpmMax: number | null;
  sort: ShareSort;
}

export const DEFAULT_SHARE_FILTERS: ShareListFilters = {
  search: '',
  genre: '',
  mood: '',
  key: '',
  type: '',
  bpmMin: null,
  bpmMax: null,
  sort: 'share',
};

/** Below this many tracks a list is short enough to read; no controls. */
export const SHARE_CONTROLS_MIN_TRACKS = 8;

/** "F#m" / "C": the canonical spelling, so `Bb` and `A#` are one facet entry. */
export function shareKeyLabel(t: Pick<ShareListTrack, 'key' | 'scale'>): string | null {
  const n = normalizeKey(t.key, t.scale);
  if (!n.key) return null;
  return n.scale === 'minor' ? `${n.key}m` : n.key;
}

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tagsIn(t: ShareListTrack, category: string): string[] {
  return (t.tags ?? []).filter((x) => x.category === category).map((x) => x.tag);
}

function searchable(t: ShareListTrack): string {
  return fold([
    t.title,
    t.type ?? '',
    shareKeyLabel(t) ?? '',
    t.key ?? '',
    t.bpm != null ? String(t.bpm) : '',
    ...(t.tags ?? []).map((x) => x.tag),
  ].join(' \n '));
}

/** Every word of the query must appear somewhere in the title, tags, key, type or BPM. */
export function matchesShareSearch(t: ShareListTrack, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = searchable(t);
  return words.every((w) => hay.includes(w));
}

function hasTag(t: ShareListTrack, category: string, wanted: string): boolean {
  const w = wanted.toLowerCase();
  return tagsIn(t, category).some((x) => x.toLowerCase() === w);
}

export function filterAndSortShareTracks<T extends ShareListTrack>(
  tracks: T[],
  f: ShareListFilters,
): T[] {
  const matched: { track: T; index: number }[] = [];
  tracks.forEach((track, index) => {
    if (f.type && (track.type ?? '') !== f.type) return;
    if (f.genre && !hasTag(track, 'genre', f.genre)) return;
    if (f.mood && !hasTag(track, 'mood', f.mood)) return;
    if (f.key && shareKeyLabel(track) !== f.key) return;
    if (f.bpmMin != null || f.bpmMax != null) {
      if (track.bpm == null) return;
      if (f.bpmMin != null && track.bpm < f.bpmMin) return;
      if (f.bpmMax != null && track.bpm > f.bpmMax) return;
    }
    if (!matchesShareSearch(track, f.search)) return;
    matched.push({ track, index });
  });

  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;
  // A missing value sorts last in either direction, never first.
  const nullsLast = (av: number | null, bv: number | null, dir: 1 | -1) => {
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  };

  switch (f.sort) {
    case 'bpm-asc':
      matched.sort((a, b) => nullsLast(a.track.bpm ?? null, b.track.bpm ?? null, 1) || byIndex(a, b));
      break;
    case 'bpm-desc':
      matched.sort((a, b) => nullsLast(a.track.bpm ?? null, b.track.bpm ?? null, -1) || byIndex(a, b));
      break;
    case 'title':
      matched.sort((a, b) =>
        a.track.title.localeCompare(b.track.title, undefined, { numeric: true, sensitivity: 'base' }) || byIndex(a, b));
      break;
    case 'newest': {
      const time = (t: T) => {
        const ms = t.created_at ? Date.parse(t.created_at) : NaN;
        return Number.isFinite(ms) ? ms : null;
      };
      matched.sort((a, b) => nullsLast(time(a.track), time(b.track), -1) || byIndex(a, b));
      break;
    }
    case 'share':
    default:
      // The producer's arrangement; already the input order.
      break;
  }
  return matched.map((m) => m.track);
}

export interface FacetEntry {
  value: string;
  count: number;
}

export interface ShareFacets {
  genres: FacetEntry[];
  moods: FacetEntry[];
  keys: FacetEntry[];
  types: FacetEntry[];
  bpm: { min: number; max: number } | null;
  hasDates: boolean;
}

function tally(values: (string | null | undefined)[]): FacetEntry[] {
  const counts = new Map<string, FacetEntry>();
  for (const raw of values) {
    const v = raw?.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    const hit = counts.get(k);
    if (hit) hit.count += 1;
    else counts.set(k, { value: v, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function buildShareFacets(tracks: ShareListTrack[]): ShareFacets {
  const bpms = tracks.map((t) => t.bpm).filter((b): b is number => typeof b === 'number' && Number.isFinite(b) && b > 0);
  return {
    genres: tally(tracks.flatMap((t) => tagsIn(t, 'genre'))),
    moods: tally(tracks.flatMap((t) => tagsIn(t, 'mood'))),
    keys: tally(tracks.map((t) => shareKeyLabel(t))),
    types: tally(tracks.map((t) => t.type)),
    bpm: bpms.length ? { min: Math.min(...bpms), max: Math.max(...bpms) } : null,
    hasDates: tracks.some((t) => !!t.created_at && Number.isFinite(Date.parse(t.created_at))),
  };
}

export interface ShareControlsVisibility {
  /** Any control at all; false for a short list. */
  any: boolean;
  search: boolean;
  sort: boolean;
  newest: boolean;
  genre: boolean;
  mood: boolean;
  key: boolean;
  type: boolean;
  bpm: boolean;
}

/**
 * Which controls earn their place. A share of three beats shows none of this,
 * and a facet with one value (every beat is a "beat", one genre) is not a
 * filter, so it does not render a dropdown that can only say what the list
 * already says.
 */
export function shareControlsVisibility(count: number, facets: ShareFacets): ShareControlsVisibility {
  const any = count >= SHARE_CONTROLS_MIN_TRACKS;
  return {
    any,
    search: any,
    sort: any,
    newest: facets.hasDates,
    genre: any && facets.genres.length >= 2,
    mood: any && facets.moods.length >= 2,
    key: any && facets.keys.length >= 2,
    type: any && facets.types.length >= 2,
    bpm: any && facets.bpm != null && facets.bpm.max > facets.bpm.min,
  };
}

/** How many filters (not the sort) are narrowing the list; drives "Clear". */
export function activeShareFilterCount(f: ShareListFilters): number {
  return [
    f.search.trim() !== '',
    f.genre !== '',
    f.mood !== '',
    f.key !== '',
    f.type !== '',
    f.bpmMin != null || f.bpmMax != null,
  ].filter(Boolean).length;
}

/** Parse a BPM text field: empty or not a positive number is "no bound". */
export function parseBpmBound(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** "12 of 50" while narrowed, "50 tracks" otherwise. */
export function shareCountLabel(shown: number, total: number): string {
  if (shown === total) return `${total} ${total === 1 ? 'track' : 'tracks'}`;
  return `${shown} of ${total}`;
}
