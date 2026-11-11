import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type LibraryFilters } from '@/components/library/FilterBar';
import {
  DEFAULT_SHARE_VIEW,
  decodeShareView,
  encodeShareView,
  filterAndSortShareTracks,
  isDefaultShareView,
  matchesShareSearch,
  shareCountLabel,
  type ShareViewState,
  type ShareViewTrack,
} from './track-list';

const t = (id: string, o: Partial<ShareViewTrack> = {}): ShareViewTrack => ({ id, title: id, ...o });
const view = (o: Partial<ShareViewState> = {}, f: Partial<LibraryFilters> = {}): ShareViewState => ({
  ...DEFAULT_SHARE_VIEW, ...o, filters: { ...DEFAULT_FILTERS, ...f },
});
const ids = (xs: ShareViewTrack[]) => xs.map((x) => x.id);

const set: ShareViewTrack[] = [
  t('Night Shift', { bpm: 140, key: 'F', scale: 'minor', type: 'beat', created_at: '2026-03-01', track_tags: [{ tag: 'Dark', category: 'mood' }, { tag: 'Trap', category: 'genre' }] }),
  t('Cold Front', { bpm: 92, key: 'C', scale: 'major', type: 'beat', created_at: '2026-05-01', track_tags: [{ tag: 'Chill', category: 'mood' }, { tag: 'Lo-Fi', category: 'genre' }] }),
  t('Loop 2', { bpm: 92, key: 'G', scale: 'major', type: 'loop', created_at: '2026-04-01' }),
  t('Untitled 10', { bpm: null, key: null, type: 'beat' }),
  t('Untitled 9', { bpm: 150, key: 'A', scale: 'minor', type: 'beat', track_tags: [{ tag: 'Trap', category: 'genre' }, { tag: 'ready to send', category: 'custom' }] }),
];

describe('filterAndSortShareTracks', () => {
  it('keeps the share order by default and does not mutate its input', () => {
    const copy = [...set];
    expect(ids(filterAndSortShareTracks(set, view()))).toEqual(['Night Shift', 'Cold Front', 'Loop 2', 'Untitled 10', 'Untitled 9']);
    expect(set).toEqual(copy);
  });

  it("uses the Library's own filters: type, genre, tags by name, BPM, key", () => {
    expect(ids(filterAndSortShareTracks(set, view({}, { types: new Set(['loop']) })))).toEqual(['Loop 2']);
    expect(ids(filterAndSortShareTracks(set, view({}, { genres: new Set(['Trap']) })))).toEqual(['Night Shift', 'Untitled 9']);
    // The tags facet matches by NAME, whatever category the producer's bulk tagger stored.
    expect(ids(filterAndSortShareTracks(set, view({}, { tags: new Set(['ready to send']) })))).toEqual(['Untitled 9']);
    expect(ids(filterAndSortShareTracks(set, view({}, { bpmMin: 90, bpmMax: 100 })))).toEqual(['Cold Front', 'Loop 2']);
    expect(ids(filterAndSortShareTracks(set, view({}, { keys: new Set(['G']) })))).toEqual(['Loop 2']);
  });

  it('ignores the owner-only facets, even from a hand-edited URL', () => {
    const f = { statuses: new Set(['finished']), rating: 5, offlineOnly: true };
    expect(filterAndSortShareTracks(set, view({}, f))).toHaveLength(5);
  });

  it('search needs every word, across title, tags, key, BPM and type', () => {
    expect(ids(filterAndSortShareTracks(set, view({ search: 'night' })))).toEqual(['Night Shift']);
    expect(ids(filterAndSortShareTracks(set, view({ search: 'dark trap' })))).toEqual(['Night Shift']);
    expect(ids(filterAndSortShareTracks(set, view({ search: '92' })))).toEqual(['Cold Front', 'Loop 2']);
    expect(ids(filterAndSortShareTracks(set, view({ search: 'dark chill' })))).toEqual([]);
    expect(matchesShareSearch(t('Café'), 'cafe')).toBe(true);
    expect(matchesShareSearch(t('x'), '  ')).toBe(true);
  });

  it('sorts by BPM with a missing tempo last, by title naturally, by key on the circle of fifths, newest first', () => {
    expect(ids(filterAndSortShareTracks(set, view({ sort: 'bpm' })))).toEqual(['Cold Front', 'Loop 2', 'Night Shift', 'Untitled 9', 'Untitled 10']);
    expect(ids(filterAndSortShareTracks(set, view({ sort: 'bpm-desc' })))).toEqual(['Untitled 9', 'Night Shift', 'Cold Front', 'Loop 2', 'Untitled 10']);
    expect(ids(filterAndSortShareTracks(set, view({ sort: 'title' })))).toEqual(['Cold Front', 'Loop 2', 'Night Shift', 'Untitled 9', 'Untitled 10']);
    expect(ids(filterAndSortShareTracks(set, view({ sort: 'key' })))).toEqual(['Cold Front', 'Loop 2', 'Untitled 9', 'Night Shift', 'Untitled 10']);
    expect(ids(filterAndSortShareTracks(set, view({ sort: 'recent' })))).toEqual(['Cold Front', 'Loop 2', 'Night Shift', 'Untitled 10', 'Untitled 9']);
  });
});

describe('URL state', () => {
  it("round-trips through the Library's codec and keeps the page's own params", () => {
    const v = view({ sort: 'bpm', search: 'night' }, { tags: new Set(['ready to send']), genres: new Set(['Trap']), bpmMin: 90 });
    const qs = encodeShareView(v, 'purchase=success&session_id=cs_1');
    const p = new URLSearchParams(qs);
    expect(p.get('purchase')).toBe('success');
    expect(p.get('session_id')).toBe('cs_1');
    expect(p.getAll('tag')).toEqual(['ready to send']);
    expect(p.get('q')).toBe('night');
    const back = decodeShareView(qs);
    expect(back.sort).toBe('bpm');
    expect(back.search).toBe('night');
    expect([...back.filters.tags]).toEqual(['ready to send']);
    expect(back.filters.bpmMin).toBe(90);
  });

  it('writes nothing for the default view and replaces its own old params', () => {
    expect(encodeShareView(DEFAULT_SHARE_VIEW, 'tag=old&q=old&sort=title&purchase=cancelled')).toBe('purchase=cancelled');
  });

  it('drops owner facets and unknown sorts from a pasted URL', () => {
    const v = decodeShareView('status=finished&stage=needs_price&rating=5&offline=1&sort=plays');
    expect(v.filters.statuses.size + v.filters.triage.size).toBe(0);
    expect(v.filters.rating).toBeNull();
    expect(v.filters.offlineOnly).toBe(false);
    expect(v.sort).toBe('share');
    expect(isDefaultShareView(v)).toBe(true);
  });
});

describe('shareCountLabel', () => {
  it('words the count', () => {
    expect(shareCountLabel(50, 50)).toBe('50 tracks');
    expect(shareCountLabel(1, 1)).toBe('1 track');
    expect(shareCountLabel(12, 50)).toBe('12 of 50');
  });
});
