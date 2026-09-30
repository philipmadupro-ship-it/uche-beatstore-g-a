import { describe, expect, it } from 'vitest';
import { contactGroups, groupOfCategory, otherRoleBadge, sentByType, splitByRole } from './roles';

describe('groupOfCategory', () => {
  it('maps categories onto the four tabs', () => {
    expect(groupOfCategory('Rapper')).toBe('artist');
    expect(groupOfCategory('producer')).toBe('producer');
    expect(groupOfCategory('a&r')).toBe('label');
    expect(groupOfCategory('manager')).toBe('label');
    expect(groupOfCategory('buyer')).toBe('other');
    expect(groupOfCategory('')).toBeNull();
  });
});

describe('contactGroups', () => {
  it('main role first, then the one extra', () => {
    expect(contactGroups({ category: 'artist', secondary_category: 'producer' })).toEqual(['artist', 'producer']);
    expect(contactGroups({ category: 'producer', secondary_category: 'rapper' })).toEqual(['producer', 'artist']);
    expect(contactGroups({ category: 'label', secondary_category: 'a&r' })).toEqual(['label']);
  });
  it('a linked contact with no specific role is an artist, as before roles', () => {
    expect(contactGroups({ category: null }, true)).toEqual(['artist']);
    expect(contactGroups({ category: 'friend' }, true)).toEqual(['artist']);
    expect(contactGroups({ category: 'producer' }, true)).toEqual(['producer']);
  });
  it('everyone else is Other', () => {
    expect(contactGroups({ category: 'buyer' })).toEqual(['other']);
    expect(contactGroups({})).toEqual(['other']);
  });
});

describe('splitByRole', () => {
  it('puts a two-role contact in two tabs', () => {
    const tabs = splitByRole([
      { id: 'a', category: 'artist', secondary_category: 'producer' },
      { id: 'b', category: 'buyer' },
      { id: 'c', category: null },
    ], new Set(['c']));
    expect(tabs.artist.map((c) => c.id)).toEqual(['a', 'c']);
    expect(tabs.producer.map((c) => c.id)).toEqual(['a']);
    expect(tabs.other.map((c) => c.id)).toEqual(['b']);
  });
  it('badges the other role', () => {
    expect(otherRoleBadge({ category: 'artist', secondary_category: 'producer' }, false, 'artist')).toBe('also Producer');
    expect(otherRoleBadge({ category: 'artist', secondary_category: 'label' }, false, 'artist')).toBe('also Label / A&R');
    expect(otherRoleBadge({ category: 'artist' }, false, 'artist')).toBeNull();
  });
});

describe('sentByType', () => {
  it('counts each track once, by type, and packs by send', () => {
    const types = new Map([['l1', 'loop'], ['l2', 'loop'], ['t1', 'topline'], ['b1', 'beat'], ['s1', 'song']]);
    expect(sentByType([
      { track_ids: ['l1', 'b1'] }, { track_ids: ['l1', 'l2', 't1'] }, { track_ids: ['s1'], kind: 'project' },
    ], types)).toEqual({ beats: 1, loops: 2, toplines: 1, songs: 1, packs: 1 });
  });
});
