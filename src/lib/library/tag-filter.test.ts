import { describe, expect, it } from 'vitest';
import { buildTagFacetOptions, matchesTagFilter, tagGroupOf } from './tag-filter';

const tags = (...names: string[]) => names.map((tag) => ({ tag, category: 'custom' }));

describe('tagGroupOf', () => {
  it('groups taxonomy tags and treats the rest as custom, ignoring case', () => {
    expect(tagGroupOf('Ready to send')).toBe('status');
    expect(tagGroupOf('ready to send')).toBe('status');
    expect(tagGroupOf('Dark')).toBe('mood');
    expect(tagGroupOf('piano')).toBe('instruments');
    expect(tagGroupOf('chicago')).toBe('custom');
  });
});

describe('matchesTagFilter', () => {
  it('empty selection passes everything', () => {
    expect(matchesTagFilter([], new Set())).toBe(true);
    expect(matchesTagFilter(null, new Set())).toBe(true);
  });

  it('finds "Ready to send" even when bulk-tagged as lower-case custom', () => {
    expect(matchesTagFilter(tags('ready to send'), new Set(['Ready to send']))).toBe(true);
    expect(matchesTagFilter(tags('needs mix'), new Set(['Ready to send']))).toBe(false);
    expect(matchesTagFilter(undefined, new Set(['Ready to send']))).toBe(false);
  });

  it('any within a group', () => {
    const f = new Set(['Dark', 'Chill']);
    expect(matchesTagFilter(tags('Chill'), f)).toBe(true);
    expect(matchesTagFilter(tags('Hype'), f)).toBe(false);
  });

  it('all across groups', () => {
    const f = new Set(['Dark', 'Ready to send']);
    expect(matchesTagFilter(tags('Dark'), f)).toBe(false);
    expect(matchesTagFilter(tags('Dark', 'Ready to send', 'Trap'), f)).toBe(true);
  });

  it('custom tags are a group of their own', () => {
    expect(matchesTagFilter(tags('Chicago'), new Set(['chicago']))).toBe(true);
    expect(matchesTagFilter(tags('Chicago'), new Set(['chicago', 'Dark']))).toBe(false);
  });
});

describe('buildTagFacetOptions', () => {
  const tracks = [
    { track_tags: tags('Ready to send', 'Dark', 'Trap', 'chicago') },
    { track_tags: tags('ready to send', 'Chicago') },
    { track_tags: [] },
    {},
  ];
  const o = buildTagFacetOptions(tracks);

  it('lists the whole taxonomy with counts, folding case', () => {
    expect(o.status.find((x) => x.tag === 'Ready to send')?.count).toBe(2);
    expect(o.status.find((x) => x.tag === 'Needs mix')?.count).toBe(0);
    expect(o.mood.find((x) => x.tag === 'Dark')?.count).toBe(1);
  });

  it('offers the producer’s own tags once, and never genres', () => {
    expect(o.custom).toEqual([{ tag: 'chicago', count: 2 }]);
    expect([...o.status, ...o.mood, ...o.instruments, ...o.custom].some((x) => x.tag === 'Trap')).toBe(false);
  });
});
