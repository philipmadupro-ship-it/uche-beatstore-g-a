import type { Track } from '@/lib/types';

/**
 * Choosing tracks to share, at catalogue scale.
 *
 * A picker that is only a search box works fine at forty beats and collapses
 * at six hundred: you cannot search for something you have not remembered the
 * name of. What a producer actually knows when they open a share modal is the
 * SHAPE of what they want — "the dark drill ones around 140", "whatever I
 * uploaded this month", "the four-star ones". These are the axes that turn a
 * six-hundred-row list back into a browsable one.
 *
 * Extracted rather than inlined in the modal for the reason the store filters
 * were: logic that lives in a component cannot be tested, and untested filter
 * logic in this repo has been silently reverted twice.
 */

/** A track as the picker sees it: tags may ride along inline from /api/tracks. */
export type PickerTrack = Track & {
  track_tags?: Array<{ tag: string; category?: string | null }> | null;
};

export type PickerSort = 'recent' | 'title' | 'bpm' | 'rating';

export interface PickerFilters {
  search: string;
  /** '' = every type. */
  type: string;
  /** '' = every tag. Matched case-insensitively against genre + mood. */
  tag: string;
  /** Musical key, e.g. 'F#'. '' = any. */
  key: string;
  /** Inclusive BPM bounds. null = unbounded on that side. */
  bpmMin: number | null;
  bpmMax: number | null;
  /** Only tracks rated at least this many stars. 0 = no rating filter. */
  minRating: number;
  /** Only tracks uploaded in the last N days. 0 = no recency filter. */
  withinDays: number;
  sort: PickerSort;
}

export const EMPTY_PICKER_FILTERS: PickerFilters = {
  search: '',
  type: '',
  tag: '',
  key: '',
  bpmMin: null,
  bpmMax: null,
  minRating: 0,
  withinDays: 0,
  sort: 'recent',
};

/** Whether anything is narrowing the list — drives the "Clear" affordance. */
export function hasActiveFilters(filters: PickerFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.type !== '' ||
    filters.tag !== '' ||
    filters.key !== '' ||
    filters.bpmMin !== null ||
    filters.bpmMax !== null ||
    filters.minRating > 0 ||
    filters.withinDays > 0
  );
}

function tagsOf(track: PickerTrack): string[] {
  return (track.track_tags ?? [])
    .filter((t) => t.category === 'genre' || t.category === 'mood')
    .map((t) => t.tag);
}

/**
 * Every genre/mood tag in the library, by descending use.
 *
 * Ordered by frequency because a tag filter is only useful if the tags a
 * producer actually uses are the ones they see first; alphabetical buries a
 * heavily-used genre under one-off experiments.
 */
export function pickerTagOptions(tracks: PickerTrack[]): string[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    for (const tag of tagsOf(track)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** Every key present in the library, musically ordered by name. */
export function pickerKeyOptions(tracks: PickerTrack[]): string[] {
  const keys = new Set<string>();
  for (const track of tracks) {
    if (track.key) keys.add(track.key);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

/**
 * Filter + sort. Pure: same inputs, same output, no clock reads beyond the
 * `now` you pass, so the recency filter is testable.
 */
export function filterPickerTracks(
  tracks: PickerTrack[],
  filters: PickerFilters,
  now: number = Date.now(),
): PickerTrack[] {
  const q = filters.search.trim().toLowerCase();
  const tagQuery = filters.tag.toLowerCase();
  const cutoff = filters.withinDays > 0 ? now - filters.withinDays * 86400000 : null;

  const result = tracks.filter((track) => {
    if (filters.type && track.type !== filters.type) return false;
    if (filters.key && track.key !== filters.key) return false;

    if (filters.bpmMin !== null && (track.bpm ?? -Infinity) < filters.bpmMin) return false;
    if (filters.bpmMax !== null && (track.bpm ?? Infinity) > filters.bpmMax) return false;

    if (filters.minRating > 0 && (track.rating ?? 0) < filters.minRating) return false;

    if (cutoff !== null) {
      const created = Date.parse(track.created_at ?? '');
      // An unparseable date is not evidence of recency — leave it out rather
      // than letting NaN comparisons quietly include everything.
      if (Number.isNaN(created) || created < cutoff) return false;
    }

    const trackTags = tagsOf(track);
    if (tagQuery && !trackTags.some((tag) => tag.toLowerCase() === tagQuery)) return false;

    if (q) {
      // Tags are searchable text too: typing "drill" should find the drill
      // beats whether or not the word is in any title.
      const haystack = [
        track.title,
        track.type,
        track.key ?? '',
        track.scale ?? '',
        track.bpm != null ? String(track.bpm) : '',
        ...trackTags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  const sorted = result.slice();
  switch (filters.sort) {
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'bpm':
      // Tracks with no BPM sink rather than clustering at the top as zeroes.
      sorted.sort((a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity));
      break;
    case 'rating':
      sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    case 'recent':
    default:
      sorted.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
      break;
  }
  return sorted;
}
