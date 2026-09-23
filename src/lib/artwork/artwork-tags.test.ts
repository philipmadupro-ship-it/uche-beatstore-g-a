import { describe, expect, it } from 'vitest';
import { artworkTagsOf } from './artwork-tags';

describe('artworkTagsOf', () => {
  it('puts genre before mood, whatever order they arrive in', () => {
    expect(
      artworkTagsOf([
        { tag: 'Dark', category: 'mood' },
        { tag: 'Drill', category: 'genre' },
        { tag: 'Hype', category: 'mood' },
      ]),
    ).toEqual(['Drill', 'Dark', 'Hype']);
  });

  it('drops instrument and status tags, which are dashboard bookkeeping', () => {
    expect(
      artworkTagsOf([
        { tag: '808s', category: 'instrument' },
        { tag: 'Needs mix', category: 'status' },
        { tag: 'Trap', category: 'genre' },
      ]),
    ).toEqual(['Trap']);
  });

  it('ignores rows with no category, rather than guessing one', () => {
    expect(artworkTagsOf([{ tag: 'Loose' }, { tag: 'Lo-fi', category: 'genre' }])).toEqual(['Lo-fi']);
  });

  it('handles absent input', () => {
    expect(artworkTagsOf(null)).toEqual([]);
    expect(artworkTagsOf(undefined)).toEqual([]);
    expect(artworkTagsOf([])).toEqual([]);
  });
});
