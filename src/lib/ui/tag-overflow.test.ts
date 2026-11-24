import { describe, it, expect } from 'vitest';
import { splitTags, hiddenTagsTitle, TAG_LIMIT_DETAIL, TAG_LIMIT_EDIT } from './tag-overflow';

const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe('splitTags', () => {
  it('shows a single tag with no toggle', () => {
    const s = splitTags(tags(1), { limit: 3 });
    expect(s.visible).toEqual(['t1']);
    expect(s.hiddenCount).toBe(0);
    expect(s.canToggle).toBe(false);
  });
  it('shows an empty set with no toggle', () => {
    expect(splitTags([], { limit: 3 }).canToggle).toBe(false);
  });
  it('collapses 10 tags to the edit limit', () => {
    const s = splitTags(tags(10), { limit: TAG_LIMIT_EDIT });
    expect(s.visible).toHaveLength(10);
    expect(s.canToggle).toBe(false);
    const d = splitTags(tags(10), { limit: TAG_LIMIT_DETAIL });
    expect(d.visible).toHaveLength(8);
    expect(d.hiddenCount).toBe(2);
    expect(d.canToggle).toBe(true);
  });
  it('collapses 60 tags and expands to all of them', () => {
    const c = splitTags(tags(60), { limit: 8 });
    expect(c.visible).toHaveLength(8);
    expect(c.hiddenCount).toBe(52);
    expect(c.hidden[0]).toBe('t9');
    const e = splitTags(tags(60), { limit: 8, expanded: true });
    expect(e.visible).toHaveLength(60);
    expect(e.hiddenCount).toBe(0);
    expect(e.canToggle).toBe(true);
  });
  it('never hides exactly one tag (limit + 1 shows everything)', () => {
    const s = splitTags(tags(4), { limit: 3 });
    expect(s.visible).toHaveLength(4);
    expect(s.canToggle).toBe(false);
    expect(splitTags(tags(5), { limit: 3 }).hiddenCount).toBe(2);
  });
  it('strict collapses at limit + 1 for fixed-width rows', () => {
    const s = splitTags(tags(3), { limit: 2, strict: true });
    expect(s.visible).toHaveLength(2);
    expect(s.hiddenCount).toBe(1);
  });
  it('keeps order and does not mutate the input', () => {
    const input = tags(6);
    splitTags(input, { limit: 2 });
    expect(input).toEqual(tags(6));
  });
  it('titles the hidden names', () => {
    expect(hiddenTagsTitle(['a', 'b'])).toBe('a, b');
  });
});
