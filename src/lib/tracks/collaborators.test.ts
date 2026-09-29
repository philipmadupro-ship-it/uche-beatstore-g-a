import { describe, expect, it } from 'vitest';
import { groupCredits, isAutoDerived, roleLabel, sortCollaborators, suggestContactForCredit, visibleCredits } from './collaborators';

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

describe('suggestContactForCredit', () => {
  const contacts = [{ id: 'a', name: 'Artist  #1' }, { id: 'b', name: 'Metro' }, { id: 'c', name: 'metro' }];
  it('matches one contact by name, ignoring case and spacing', () => {
    expect(suggestContactForCredit(' artist #1 ', contacts)?.id).toBe('a');
  });
  it('offers nothing when the name is ambiguous or unknown', () => {
    expect(suggestContactForCredit('Metro', contacts)).toBeNull();
    expect(suggestContactForCredit('Nobody', contacts)).toBeNull();
    expect(suggestContactForCredit('', contacts)).toBeNull();
  });
});

describe('groupCredits', () => {
  const row = (id: string, name: string, role: string, extra: Partial<{ contact_id: string | null; source: string }> = {}) => ({
    id, track_id: 't', name, role, source: extra.source ?? 'manual', created_at: '', contact_id: extra.contact_id ?? null,
  });
  it('folds one person with several roles into one entry', () => {
    const g = groupCredits([row('1', 'Nova', 'feature'), row('2', ' nova ', 'collaborator'), row('3', 'Metro', 'producer')]);
    expect(g.map((x) => [x.name, x.roles])).toEqual([['Metro', ['producer']], ['Nova', ['feature', 'collaborator']]]);
    expect(g[1].credits.map((c) => c.id)).toEqual(['1', '2']);
  });
  it('uses the linked contact as identity and pulls in unlinked credits of the same name', () => {
    const g = groupCredits([row('1', 'Nova', 'feature', { contact_id: 'c1' }), row('2', 'Nova', 'collaborator'), row('3', 'N.O.V.A', 'producer', { contact_id: 'c1' })]);
    expect(g).toHaveLength(1);
    expect(g[0].contactId).toBe('c1');
    expect(g[0].roles).toEqual(['producer', 'feature', 'collaborator']);
  });
  it('marks a person auto when any credit came from the filename', () => {
    expect(groupCredits([row('1', 'A', 'feature', { source: 'filename' }), row('2', 'A', 'producer')])[0].auto).toBe(true);
  });
});

describe('visibleCredits', () => {
  it('shows the first three and folds the rest', () => {
    expect(visibleCredits([1, 2, 3, 4, 5], false)).toEqual({ shown: [1, 2, 3], hidden: 2 });
    expect(visibleCredits([1, 2, 3, 4, 5], true)).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 0 });
  });
  it('never folds away a single person', () => {
    expect(visibleCredits([1, 2, 3, 4], false)).toEqual({ shown: [1, 2, 3, 4], hidden: 0 });
  });
});
