import { describe, expect, it } from 'vitest';
import { genreRowId, resolveHomeRows, selectRowTracks, topGenreRows } from './home-config';

const tagged = (id: string, ...genres: string[]) => ({ id, track_tags: genres.map((tag) => ({ tag, category: 'genre' })) });

describe('genre rows', () => {
  it('keeps the original row ids for the original genres', () => {
    expect(genreRowId('Drill')).toBe('genre_drill');
    expect(genreRowId('R&B')).toBe('genre_rnb');
    expect(genreRowId('Afrobeats')).toBe('genre_afrobeats');
    expect(genreRowId('UK Drill')).toBe('genre_uk_drill');
  });
  it('takes the producer’s top three, most common first, ties alphabetical', () => {
    const rows = topGenreRows([
      tagged('1', 'Trap'), tagged('2', 'Trap'), tagged('3', 'Pop'), tagged('4', 'Drill'), tagged('5', 'Afro'),
    ]);
    expect(rows.map((r) => r.title)).toEqual(['Trap', 'Afro', 'Drill']);
    expect(rows[0].filter).toEqual({ genres: ['Trap'] });
  });
  it('ignores non-genre tags and a track repeating a genre', () => {
    const rows = topGenreRows([{ track_tags: [{ tag: 'Dark', category: 'mood' }, { tag: 'Trap', category: 'genre' }, { tag: 'Trap', category: 'genre' }] }]);
    expect(rows.map((r) => r.id)).toEqual(['genre_trap']);
  });
  it('splices genre rows after Projects and none without genres', () => {
    const ids = resolveHomeRows([tagged('1', 'Trap')]).map((r) => r.id);
    expect(ids.indexOf('genre_trap')).toBe(ids.indexOf('projects') + 1);
    expect(resolveHomeRows([]).some((r) => r.id.startsWith('genre_'))).toBe(false);
  });
});

describe('selectRowTracks', () => {
  const T = (...ids: string[]) => ids.map((id) => ({ id }));
  it('never removes a track from a status row, and status rows do not feed dedupe', () => {
    const out = selectRowTracks([
      { id: 'wip', tracks: T('a', 'b') },
      { id: 'genre_trap', tracks: T('a', 'b', 'c', 'd', 'e', 'f') },
    ]);
    expect(out.wip.map((t) => t.id)).toEqual(['a', 'b']);
    expect(out.genre_trap).toHaveLength(6);
  });
  it('drops repeats across discovery rows when the row stays full enough', () => {
    const out = selectRowTracks([
      { id: 'genre_trap', tracks: T('a', 'b', 'c', 'd') },
      { id: 'store', tracks: T('a', 'b', 'x', 'y', 'z', 'w') },
    ]);
    expect(out.store.map((t) => t.id)).toEqual(['x', 'y', 'z', 'w']);
  });
  it('keeps the row whole rather than gutting it', () => {
    const out = selectRowTracks([
      { id: 'genre_trap', tracks: T('a', 'b') },
      { id: 'top_rated', tracks: T('a', 'b') },
    ]);
    expect(out.top_rated.map((t) => t.id)).toEqual(['a', 'b']);
  });
  it('applies each row’s cap', () => {
    const out = selectRowTracks([{ id: 'store', maxItems: 2, tracks: T('a', 'b', 'c') }]);
    expect(out.store).toHaveLength(2);
  });
});
