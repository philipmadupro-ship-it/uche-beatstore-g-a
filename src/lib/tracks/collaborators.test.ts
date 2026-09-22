import { describe, expect, it } from 'vitest';
import { isAutoDerived, roleLabel, sortCollaborators } from './collaborators';

describe('sortCollaborators', () => {
  it('orders producer before feature before collaborator', () => {
    const rows = [
      { name: 'Zed', role: 'collaborator' },
      { name: 'Ann', role: 'feature' },
      { name: 'Metro', role: 'producer' },
    ];
    expect(sortCollaborators(rows).map((r) => r.name)).toEqual(['Metro', 'Ann', 'Zed']);
  });

  it('sorts alphabetically within the same role', () => {
    const rows = [
      { name: 'Zed', role: 'producer' },
      { name: 'Ann', role: 'producer' },
    ];
    expect(sortCollaborators(rows).map((r) => r.name)).toEqual(['Ann', 'Zed']);
  });

  it('does not mutate the input array', () => {
    const rows = [{ name: 'B', role: 'producer' }, { name: 'A', role: 'producer' }];
    const copy = [...rows];
    sortCollaborators(rows);
    expect(rows).toEqual(copy);
  });

  it('places an unknown role after the three known ones', () => {
    const rows = [
      { name: 'Mystery', role: 'engineer' },
      { name: 'Metro', role: 'producer' },
    ];
    expect(sortCollaborators(rows).map((r) => r.name)).toEqual(['Metro', 'Mystery']);
  });
});

describe('isAutoDerived', () => {
  it('is true only for the filename source', () => {
    expect(isAutoDerived('filename')).toBe(true);
    expect(isAutoDerived('manual')).toBe(false);
  });
});

describe('roleLabel', () => {
  it('labels the three known roles', () => {
    expect(roleLabel('producer')).toBe('Producer');
    expect(roleLabel('feature')).toBe('Feature');
    expect(roleLabel('collaborator')).toBe('Collaborator');
  });

  it('passes an unknown role through unchanged', () => {
    expect(roleLabel('engineer')).toBe('engineer');
  });
});
