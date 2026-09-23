import { describe, expect, it } from 'vitest';
import {
  EMPTY_PICKER_FILTERS,
  filterPickerTracks,
  hasActiveFilters,
  pickerKeyOptions,
  pickerTagOptions,
  type PickerTrack,
} from './track-picker';

const NOW = Date.parse('2026-08-20T00:00:00Z');

function track(over: Partial<PickerTrack> & { id: string }): PickerTrack {
  return {
    user_id: 'owner',
    title: over.id,
    type: 'beat',
    audio_url: '',
    duration_seconds: 120,
    bpm: 140,
    stems_status: 'none',
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  } as PickerTrack;
}

const LIBRARY: PickerTrack[] = [
  track({
    id: 'drill', title: 'Cold Corner', bpm: 142, key: 'F#', rating: 5,
    created_at: '2026-08-18T00:00:00Z',
    track_tags: [{ tag: 'Drill', category: 'genre' }, { tag: 'Dark', category: 'mood' }],
  }),
  track({
    id: 'afro', title: 'Lagos Morning', type: 'instrumental', bpm: 104, key: 'C', rating: 3,
    created_at: '2026-05-01T00:00:00Z',
    track_tags: [{ tag: 'Afrobeats', category: 'genre' }, { tag: '808s', category: 'instrument' }],
  }),
  track({ id: 'sketch', title: 'Untitled 4', bpm: null, key: null, rating: null, created_at: '2026-08-19T00:00:00Z' }),
];

describe('filterPickerTracks', () => {
  it('searches titles, keys, bpm and tags alike', () => {
    const byTag = filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, search: 'drill' }, NOW);
    expect(byTag.map((t) => t.id)).toEqual(['drill']);

    const byTitle = filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, search: 'lagos' }, NOW);
    expect(byTitle.map((t) => t.id)).toEqual(['afro']);

    const byBpm = filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, search: '104' }, NOW);
    expect(byBpm.map((t) => t.id)).toEqual(['afro']);
  });

  it('filters by type, key, rating and BPM range', () => {
    expect(
      filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, type: 'instrumental' }, NOW).map((t) => t.id),
    ).toEqual(['afro']);
    expect(
      filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, key: 'F#' }, NOW).map((t) => t.id),
    ).toEqual(['drill']);
    expect(
      filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, minRating: 4 }, NOW).map((t) => t.id),
    ).toEqual(['drill']);
    expect(
      filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, bpmMin: 130, bpmMax: 150 }, NOW).map((t) => t.id),
    ).toEqual(['drill']);
  });

  it('excludes BPM-less tracks from a bounded BPM range rather than defaulting them in', () => {
    const ids = filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, bpmMin: 100 }, NOW).map((t) => t.id);
    expect(ids).not.toContain('sketch');
  });

  it('matches a tag filter exactly, and only on genre/mood', () => {
    expect(
      filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, tag: 'Dark' }, NOW).map((t) => t.id),
    ).toEqual(['drill']);
    // '808s' is an instrument tag — dashboard-only, not a browse axis here.
    expect(filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, tag: '808s' }, NOW)).toEqual([]);
  });

  it('scopes to recent uploads relative to the injected clock', () => {
    const ids = filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, withinDays: 7 }, NOW).map((t) => t.id);
    expect(ids).toEqual(['sketch', 'drill']);
  });

  it('sorts newest first by default, and sinks BPM-less tracks on a BPM sort', () => {
    expect(filterPickerTracks(LIBRARY, EMPTY_PICKER_FILTERS, NOW).map((t) => t.id))
      .toEqual(['sketch', 'drill', 'afro']);
    expect(filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, sort: 'bpm' }, NOW).map((t) => t.id))
      .toEqual(['afro', 'drill', 'sketch']);
    expect(filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, sort: 'title' }, NOW).map((t) => t.id))
      .toEqual(['drill', 'afro', 'sketch']);
    expect(filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, sort: 'rating' }, NOW).map((t) => t.id))
      .toEqual(['drill', 'afro', 'sketch']);
  });

  it('does not mutate the input array', () => {
    const before = LIBRARY.map((t) => t.id);
    filterPickerTracks(LIBRARY, { ...EMPTY_PICKER_FILTERS, sort: 'title' }, NOW);
    expect(LIBRARY.map((t) => t.id)).toEqual(before);
  });
});

describe('option lists', () => {
  it('orders tags by how often they are used', () => {
    const tracks = [
      ...LIBRARY,
      track({ id: 'x', track_tags: [{ tag: 'Drill', category: 'genre' }] }),
    ];
    expect(pickerTagOptions(tracks)[0]).toBe('Drill');
    expect(pickerTagOptions(tracks)).not.toContain('808s');
  });

  it('lists only keys that exist', () => {
    expect(pickerKeyOptions(LIBRARY)).toEqual(['C', 'F#']);
  });
});

describe('hasActiveFilters', () => {
  it('ignores sort, which never hides anything', () => {
    expect(hasActiveFilters(EMPTY_PICKER_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_PICKER_FILTERS, sort: 'title' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_PICKER_FILTERS, tag: 'Drill' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_PICKER_FILTERS, bpmMin: 100 })).toBe(true);
  });
});
