import { describe, it, expect } from 'vitest';
import { categoryForTag, orderTags, canAddCustomTag, type TagGroup } from './tag-groups';

const groups: TagGroup[] = [
  { category: 'project_type', label: 'Project type', options: ['Album', 'EP'] },
  { category: 'genre', label: 'Genre', options: ['Trap', 'Drill'] },
  { category: 'mood', label: 'Mood', options: ['Dark'] },
];

describe('categoryForTag', () => {
  it('resolves a tag to the category it is stored under', () => {
    expect(categoryForTag(groups, 'Trap')).toBe('genre');
    expect(categoryForTag(groups, 'Album')).toBe('project_type');
  });

  it('matches case-insensitively', () => {
    expect(categoryForTag(groups, 'dark')).toBe('mood');
  });

  it('falls back to custom for user-invented tags', () => {
    expect(categoryForTag(groups, 'summer-2026')).toBe('custom');
  });
});

describe('orderTags', () => {
  it('orders by declared group, then position within the group', () => {
    expect(orderTags(groups, ['Dark', 'Drill', 'Album', 'Trap']))
      .toEqual(['Album', 'Trap', 'Drill', 'Dark']);
  });

  it('puts custom tags last, alphabetically', () => {
    expect(orderTags(groups, ['zeta', 'alpha', 'Trap']))
      .toEqual(['Trap', 'alpha', 'zeta']);
  });

  it('does not mutate the input', () => {
    const input = ['Dark', 'Album'];
    orderTags(groups, input);
    expect(input).toEqual(['Dark', 'Album']);
  });
});

describe('canAddCustomTag', () => {
  it('rejects blank input', () => {
    expect(canAddCustomTag([], '   ')).toBe(false);
  });

  it('rejects a duplicate regardless of case', () => {
    expect(canAddCustomTag(['Trap'], 'trap')).toBe(false);
  });

  it('accepts a new tag', () => {
    expect(canAddCustomTag(['Trap'], 'Drill')).toBe(true);
  });
});
