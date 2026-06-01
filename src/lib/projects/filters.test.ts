import { describe, it, expect } from 'vitest';
import {
  filterAndSortProjects,
  activeProjectFilterCount,
  type ProjectListItem,
  type ProjectFilterState,
  type ProjectStatusFilter,
  type FolderFilter,
  type ProjectSortMode,
} from './filters';

let seq = 0;
function makeProject(p: Partial<ProjectListItem> = {}): ProjectListItem {
  seq += 1;
  return {
    id: p.id ?? `p${seq}`,
    name: p.name ?? `Project ${seq}`,
    status: p.status ?? 'in_progress',
    track_count: p.track_count ?? 0,
    created_at: p.created_at ?? `2024-01-${String(seq).padStart(2, '0')}T00:00:00Z`,
    updated_at: p.updated_at ?? `2024-02-${String(seq).padStart(2, '0')}T00:00:00Z`,
    tags: p.tags ?? [],
    folder_ids: p.folder_ids ?? [],
    ...p,
  };
}

function filters(o: {
  search?: string;
  status?: ProjectStatusFilter;
  folder?: FolderFilter;
  tags?: string[];
  sort?: ProjectSortMode;
} = {}): ProjectFilterState {
  return {
    search: o.search ?? '',
    status: o.status ?? 'all',
    folder: o.folder ?? 'all',
    tags: new Set(o.tags ?? []),
    sort: o.sort ?? 'recent',
  };
}

describe('filterAndSortProjects', () => {
  it('passes everything through with default filters', () => {
    const list = [makeProject(), makeProject(), makeProject()];
    expect(filterAndSortProjects(list, filters())).toHaveLength(3);
  });

  describe('status', () => {
    it('filters by status', () => {
      const list = [
        makeProject({ id: 'a', status: 'in_progress' }),
        makeProject({ id: 'b', status: 'final' }),
        makeProject({ id: 'c', status: 'archived' }),
      ];
      expect(filterAndSortProjects(list, filters({ status: 'final' })).map((p) => p.id)).toEqual(['b']);
    });
    it('treats null status as in_progress', () => {
      const list = [makeProject({ id: 'a', status: null }), makeProject({ id: 'b', status: 'final' })];
      expect(filterAndSortProjects(list, filters({ status: 'in_progress' })).map((p) => p.id)).toEqual(['a']);
    });
  });

  describe('folder', () => {
    const list = [
      makeProject({ id: 'a', folder_ids: ['f1'] }),
      makeProject({ id: 'b', folder_ids: ['f1', 'f2'] }),
      makeProject({ id: 'c', folder_ids: [] }),
    ];
    it('all → everything', () => {
      expect(filterAndSortProjects(list, filters({ folder: 'all' }))).toHaveLength(3);
    });
    it('unfiled → only projects in no folder', () => {
      expect(filterAndSortProjects(list, filters({ folder: 'unfiled' })).map((p) => p.id)).toEqual(['c']);
    });
    it('specific folder → only members', () => {
      expect(filterAndSortProjects(list, filters({ folder: 'f2' })).map((p) => p.id)).toEqual(['b']);
      expect(filterAndSortProjects(list, filters({ folder: 'f1' })).map((p) => p.id).sort()).toEqual(['a', 'b']);
    });
  });

  describe('tags', () => {
    const list = [
      makeProject({ id: 'a', tags: [{ tag: 'Trap', category: 'genre' }, { tag: 'Dark', category: 'mood' }] }),
      makeProject({ id: 'b', tags: [{ tag: 'Trap', category: 'genre' }] }),
      makeProject({ id: 'c', tags: [{ tag: 'Album', category: 'project_type' }] }),
    ];
    it('single tag matches', () => {
      expect(filterAndSortProjects(list, filters({ tags: ['Trap'] })).map((p) => p.id).sort()).toEqual(['a', 'b']);
    });
    it('multiple tags = AND', () => {
      expect(filterAndSortProjects(list, filters({ tags: ['Trap', 'Dark'] })).map((p) => p.id)).toEqual(['a']);
    });
    it('is case-insensitive', () => {
      expect(filterAndSortProjects(list, filters({ tags: ['trap'] })).map((p) => p.id).sort()).toEqual(['a', 'b']);
    });
    it('project-type tag matches', () => {
      expect(filterAndSortProjects(list, filters({ tags: ['Album'] })).map((p) => p.id)).toEqual(['c']);
    });
  });

  describe('search', () => {
    const list = [
      makeProject({ id: 'a', name: 'Summer Tape', tags: [] }),
      makeProject({ id: 'b', name: 'Winter', tags: [{ tag: 'Afrobeats', category: 'genre' }] }),
    ];
    it('matches by name', () => {
      expect(filterAndSortProjects(list, filters({ search: 'summer' })).map((p) => p.id)).toEqual(['a']);
    });
    it('matches by tag value', () => {
      expect(filterAndSortProjects(list, filters({ search: 'afro' })).map((p) => p.id)).toEqual(['b']);
    });
  });

  describe('sort', () => {
    const list = [
      makeProject({ id: 'a', name: 'Beta', track_count: 1, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z' }),
      makeProject({ id: 'b', name: 'Alpha', track_count: 5, created_at: '2024-01-03T00:00:00Z', updated_at: '2024-03-02T00:00:00Z' }),
      makeProject({ id: 'c', name: 'Gamma', track_count: 3, created_at: '2024-01-02T00:00:00Z', updated_at: '2024-03-03T00:00:00Z' }),
    ];
    it('recent = newest created first', () => {
      expect(filterAndSortProjects(list, filters({ sort: 'recent' })).map((p) => p.id)).toEqual(['b', 'c', 'a']);
    });
    it('updated = newest updated first', () => {
      expect(filterAndSortProjects(list, filters({ sort: 'updated' })).map((p) => p.id)).toEqual(['c', 'b', 'a']);
    });
    it('name = A→Z', () => {
      expect(filterAndSortProjects(list, filters({ sort: 'name' })).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    });
    it('tracks = most first', () => {
      expect(filterAndSortProjects(list, filters({ sort: 'tracks' })).map((p) => p.id)).toEqual(['b', 'c', 'a']);
    });
  });

  it('activeProjectFilterCount counts non-defaults', () => {
    expect(activeProjectFilterCount(filters())).toBe(0);
    expect(activeProjectFilterCount(filters({ status: 'final', tags: ['Trap'] }))).toBe(2);
    expect(activeProjectFilterCount(filters({ search: 'x', folder: 'f1', status: 'final', tags: ['a'] }))).toBe(4);
  });
});
