import { describe, it, expect } from 'vitest';
import {
  customVocabulary,
  vocabularyWithApplied,
  isTaxonomyTag,
  tagKey,
} from './vocabulary';

describe('tagKey', () => {
  it('folds case and whitespace so one tag is one tag', () => {
    expect(tagKey('  Midnight Drive ')).toBe('midnight drive');
    expect(tagKey('MIDNIGHT DRIVE')).toBe(tagKey('midnight drive'));
  });
});

describe('isTaxonomyTag', () => {
  it('recognises shipped tags regardless of case', () => {
    expect(isTaxonomyTag('Trap')).toBe(true);
    expect(isTaxonomyTag('trap')).toBe(true);
    expect(isTaxonomyTag('808s')).toBe(true);
  });

  it('does not claim tags the producer invented', () => {
    expect(isTaxonomyTag('Midnight Drive')).toBe(false);
  });
});

describe('customVocabulary', () => {
  it('returns only tags the shipped taxonomy does not already offer', () => {
    const vocab = customVocabulary([
      { tag: 'Trap', category: 'genre' },
      { tag: 'Midnight Drive', category: 'custom' },
    ]);
    expect(vocab.map((v) => v.tag)).toEqual(['Midnight Drive']);
  });

  it('counts usage across tracks and ranks the most-used first', () => {
    const vocab = customVocabulary([
      { tag: 'Rare', category: 'custom' },
      { tag: 'Everywhere', category: 'custom' },
      { tag: 'Everywhere', category: 'custom' },
      { tag: 'Everywhere', category: 'custom' },
    ]);
    expect(vocab).toEqual([
      { tag: 'Everywhere', category: 'custom', count: 3 },
      { tag: 'Rare', category: 'custom', count: 1 },
    ]);
  });

  it('treats different casings as one tag and keeps the first spelling', () => {
    // The producer thinks of these as one tag, and tag_colors (mig 107) keys
    // them that way — two chips here would be two colours for one idea.
    const vocab = customVocabulary([
      { tag: 'Midnight Drive', category: 'custom' },
      { tag: 'midnight drive', category: 'custom' },
    ]);
    expect(vocab).toEqual([{ tag: 'Midnight Drive', category: 'custom', count: 2 }]);
  });

  it('sorts equal counts alphabetically so chip order is stable', () => {
    // Row order out of Postgres is not guaranteed; an unstable sort would
    // reshuffle the workspace on every refetch.
    const forward = customVocabulary([
      { tag: 'Beta', category: 'custom' },
      { tag: 'Alpha', category: 'custom' },
    ]);
    const reversed = customVocabulary([
      { tag: 'Alpha', category: 'custom' },
      { tag: 'Beta', category: 'custom' },
    ]);
    expect(forward.map((v) => v.tag)).toEqual(['Alpha', 'Beta']);
    expect(forward).toEqual(reversed);
  });

  it('does not let a null category overwrite a real one', () => {
    const vocab = customVocabulary([
      { tag: 'Midnight Drive', category: null },
      { tag: 'Midnight Drive', category: 'mood' },
    ]);
    expect(vocab[0].category).toBe('mood');
  });

  it('ignores blank and non-string rows instead of making empty chips', () => {
    const vocab = customVocabulary([
      { tag: '   ', category: 'custom' },
      { tag: 'Real', category: 'custom' },
      { tag: 42 as unknown as string, category: 'custom' },
    ]);
    expect(vocab.map((v) => v.tag)).toEqual(['Real']);
  });
});

describe('vocabularyWithApplied', () => {
  it('keeps a brand-new tag visible before any refetch has seen it', () => {
    // This is the original bug one step later: a tag applied to exactly one
    // track would drop out of the chip list the moment it was removed.
    const vocab = vocabularyWithApplied([], ['Midnight Drive']);
    expect(vocab.map((v) => v.tag)).toEqual(['Midnight Drive']);
  });

  it('does not duplicate a tag already in the vocabulary', () => {
    const vocab = vocabularyWithApplied(
      [{ tag: 'Midnight Drive', category: 'custom', count: 3 }],
      ['midnight drive'],
    );
    expect(vocab).toHaveLength(1);
    expect(vocab[0].count).toBe(3);
  });

  it('does not re-add taxonomy tags, which already have their own chips', () => {
    expect(vocabularyWithApplied([], ['Trap'])).toEqual([]);
  });
});
