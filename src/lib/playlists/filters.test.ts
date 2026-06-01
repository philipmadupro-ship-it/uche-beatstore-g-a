import { describe, it, expect } from 'vitest';
import { filterAndSortPlaylists, activePlaylistFilterCount, type PlaylistListItem, type PlaylistFilterState } from './filters';

let seq = 0;
function make(p: Partial<PlaylistListItem> = {}): PlaylistListItem {
  seq++; return { id: p.id ?? `pl${seq}`, name: p.name ?? `Playlist ${seq}`, track_count: p.track_count ?? 0, created_at: p.created_at ?? `2024-01-${String(seq).padStart(2,'0')}T00:00:00Z`, tags: p.tags ?? [], folder_ids: p.folder_ids ?? [], ...p };
}
function f(o: Partial<Omit<PlaylistFilterState,'tags'>> & { tags?: string[] } = {}): PlaylistFilterState {
  return { search: o.search ?? '', folder: o.folder ?? 'all', tags: new Set(o.tags ?? []), sort: o.sort ?? 'recent' };
}

describe('filterAndSortPlaylists', () => {
  it('passes all with defaults', () => { expect(filterAndSortPlaylists([make(), make()], f())).toHaveLength(2); });
  it('filters by folder', () => {
    const list = [make({ id: 'a', folder_ids: ['f1'] }), make({ id: 'b', folder_ids: [] }), make({ id: 'c', folder_ids: ['f1', 'f2'] })];
    expect(filterAndSortPlaylists(list, f({ folder: 'unfiled' })).map((p) => p.id)).toEqual(['b']);
    expect(filterAndSortPlaylists(list, f({ folder: 'f2' })).map((p) => p.id)).toEqual(['c']);
  });
  it('filters by tags AND', () => {
    const list = [make({ id: 'a', tags: [{ tag: 'Trap' }, { tag: 'Dark' }] }), make({ id: 'b', tags: [{ tag: 'Trap' }] })];
    expect(filterAndSortPlaylists(list, f({ tags: ['Trap', 'Dark'] })).map((p) => p.id)).toEqual(['a']);
  });
  it('searches name and tags', () => {
    const list = [make({ id: 'a', name: 'Summer', tags: [] }), make({ id: 'b', name: 'Vibe', tags: [{ tag: 'Afrobeats' }] })];
    expect(filterAndSortPlaylists(list, f({ search: 'afro' })).map((p) => p.id)).toEqual(['b']);
  });
  it('sorts by name', () => {
    const list = [make({ id: 'a', name: 'Beta' }), make({ id: 'b', name: 'Alpha' })];
    expect(filterAndSortPlaylists(list, f({ sort: 'name' })).map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('activePlaylistFilterCount', () => {
    expect(activePlaylistFilterCount(f())).toBe(0);
    expect(activePlaylistFilterCount(f({ folder: 'f1', tags: ['Trap'], search: 'x' }))).toBe(3);
  });
});
