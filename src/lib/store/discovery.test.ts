import { describe, it, expect } from 'vitest';
import {
  buildDiscoveryTerms,
  trackMatchesTerm,
  findTermBySlug,
  discoveryMetadata,
  bpmBucket,
  labelFor,
  MIN_TRACKS_PER_TERM,
  type DiscoveryTrack,
} from './discovery';

const track = (
  id: string,
  opts: Partial<DiscoveryTrack> = {},
): DiscoveryTrack => ({
  id,
  title: `Track ${id}`,
  type: 'beat',
  bpm: 140,
  tags: [],
  ...opts,
});

const tagged = (id: string, genre?: string, mood?: string, bpm = 140): DiscoveryTrack => track(id, {
  bpm,
  tags: [
    ...(genre ? [{ tag: genre, category: 'genre' }] : []),
    ...(mood ? [{ tag: mood, category: 'mood' }] : []),
  ],
});

describe('bpmBucket', () => {
  it('buckets into phrases people search for, not exact values', () => {
    expect(bpmBucket(140)).toBe('140 bpm');
    expect(bpmBucket(75)).toBe('slow');
    expect(bpmBucket(200)).toBe('fast');
  });

  it('returns null when there is no usable BPM', () => {
    for (const v of [null, undefined, NaN, Infinity]) {
      expect(bpmBucket(v as number)).toBeNull();
    }
  });
});

describe('labelFor', () => {
  it('phrases genres and moods the way people search', () => {
    expect(labelFor('genre', 'trap')).toBe('Trap Type Beat');
    expect(labelFor('mood', 'dark')).toBe('Dark Type Beat');
  });

  it('pluralises track types', () => {
    expect(labelFor('type', 'instrumental')).toBe('Instrumentals');
  });
});

describe('buildDiscoveryTerms', () => {
  it('generates a page per genre with enough tracks', () => {
    const terms = buildDiscoveryTerms([
      tagged('1', 'Trap'), tagged('2', 'Trap'), tagged('3', 'Trap'),
    ]);
    const trap = terms.find((t) => t.slug === 'trap-type-beat');
    expect(trap).toBeTruthy();
    expect(trap!.count).toBe(3);
  });

  it('refuses to generate a page that would be nearly empty', () => {
    // A page promising "Drill type beats" that shows two unrelated results
    // wastes the visit and gets demoted as thin content. Better no page.
    const terms = buildDiscoveryTerms([tagged('1', 'Drill'), tagged('2', 'Drill')]);
    expect(terms.find((t) => t.value === 'Drill')).toBeUndefined();
  });

  it('respects a custom threshold', () => {
    const terms = buildDiscoveryTerms([tagged('1', 'Drill')], 1);
    expect(terms.find((t) => t.value === 'Drill')).toBeTruthy();
  });

  it('counts a track once per term even with duplicate tags', () => {
    const dupe = track('1', {
      tags: [{ tag: 'Trap', category: 'genre' }, { tag: 'Trap', category: 'genre' }],
    });
    const terms = buildDiscoveryTerms([dupe, tagged('2', 'Trap'), tagged('3', 'Trap')], 1);
    expect(terms.find((t) => t.slug === 'trap-type-beat')!.count).toBe(3);
  });

  it('orders by strength so internal links point at the best pages first', () => {
    const terms = buildDiscoveryTerms([
      tagged('1', 'Trap'), tagged('2', 'Trap'), tagged('3', 'Trap'), tagged('4', 'Trap'),
      tagged('5', 'Drill'), tagged('6', 'Drill'), tagged('7', 'Drill'),
    ]);
    const genres = terms.filter((t) => t.kind === 'genre');
    expect(genres[0].value).toBe('Trap');
  });

  it('derives BPM and type terms alongside tags', () => {
    const tracks = [1, 2, 3].map((i) => tagged(String(i), 'Trap', 'Dark', 140));
    const terms = buildDiscoveryTerms(tracks);
    expect(terms.some((t) => t.kind === 'bpm' && t.value === '140 bpm')).toBe(true);
    expect(terms.some((t) => t.kind === 'type' && t.value === 'beat')).toBe(true);
    expect(terms.some((t) => t.kind === 'mood' && t.value === 'Dark')).toBe(true);
  });

  it('returns nothing for an empty or untagged catalogue', () => {
    expect(buildDiscoveryTerms([])).toEqual([]);
    const bare = [track('1', { tags: [], type: null, bpm: null })];
    expect(buildDiscoveryTerms(bare)).toEqual([]);
  });

  it('ignores blank and whitespace-only tags', () => {
    const messy = [1, 2, 3].map((i) => track(String(i), {
      tags: [{ tag: '   ', category: 'genre' }, { tag: '', category: 'mood' }],
    }));
    expect(buildDiscoveryTerms(messy).some((t) => t.kind === 'genre')).toBe(false);
  });
});

describe('trackMatchesTerm', () => {
  const terms = buildDiscoveryTerms([
    tagged('1', 'Trap', 'Dark'), tagged('2', 'Trap', 'Dark'), tagged('3', 'Trap', 'Dark'),
  ]);

  it('matches the tracks a page claims to list', () => {
    // Generation and matching are separate functions; if they disagreed a
    // "Trap" page could render tracks that are not trap.
    const trap = findTermBySlug(terms, 'trap-type-beat')!;
    expect(trackMatchesTerm(tagged('x', 'Trap'), trap)).toBe(true);
    expect(trackMatchesTerm(tagged('y', 'Drill'), trap)).toBe(false);
  });

  it('is case-insensitive, since tags are free text', () => {
    const trap = findTermBySlug(terms, 'trap-type-beat')!;
    expect(trackMatchesTerm(tagged('x', 'TRAP'), trap)).toBe(true);
  });

  it('does not match a genre tag against a mood term', () => {
    const dark = terms.find((t) => t.kind === 'mood')!;
    const genreOnly = track('z', { tags: [{ tag: 'Dark', category: 'genre' }] });
    expect(trackMatchesTerm(genreOnly, dark)).toBe(false);
  });

  it('matches BPM by bucket rather than exact value', () => {
    const bpmTerm = terms.find((t) => t.kind === 'bpm')!;
    expect(trackMatchesTerm(track('x', { bpm: 145 }), bpmTerm)).toBe(true);
    expect(trackMatchesTerm(track('y', { bpm: 90 }), bpmTerm)).toBe(false);
  });

  it('every generated term matches at least MIN_TRACKS_PER_TERM tracks', () => {
    // The property that keeps a page honest: what it promises, it delivers.
    const catalogue = [
      tagged('1', 'Trap', 'Dark'), tagged('2', 'Trap', 'Dark'),
      tagged('3', 'Trap', 'Eerie'), tagged('4', 'Drill', 'Dark'),
      tagged('5', 'Drill', 'Dark'), tagged('6', 'Drill', 'Dark'),
    ];
    for (const term of buildDiscoveryTerms(catalogue)) {
      const matches = catalogue.filter((t) => trackMatchesTerm(t, term));
      expect(matches.length).toBeGreaterThanOrEqual(MIN_TRACKS_PER_TERM);
      expect(matches.length).toBe(term.count);
    }
  });
});

describe('findTermBySlug', () => {
  const terms = buildDiscoveryTerms([tagged('1', 'Trap'), tagged('2', 'Trap'), tagged('3', 'Trap')]);

  it('finds a term regardless of case', () => {
    expect(findTermBySlug(terms, 'TRAP-TYPE-BEAT')?.value).toBe('Trap');
  });

  it('returns null for an unknown slug so the page can 404', () => {
    expect(findTermBySlug(terms, 'nope')).toBeNull();
  });
});

describe('discoveryMetadata', () => {
  const term = findTermBySlug(
    buildDiscoveryTerms([tagged('1', 'Trap'), tagged('2', 'Trap'), tagged('3', 'Trap')]),
    'trap-type-beat',
  )!;

  it('states what the page actually contains', () => {
    const meta = discoveryMetadata(term, 'Uche2crazyyyy');
    expect(meta.title).toContain('Trap Type Beat');
    expect(meta.title).toContain('Uche2crazyyyy');
    expect(meta.description).toContain('3');
  });

  it('singularises a one-track page', () => {
    const single = findTermBySlug(buildDiscoveryTerms([tagged('1', 'Trap')], 1), 'trap-type-beat')!;
    // Singular keeps the label as-is; plural pluralises the label itself.
    expect(discoveryMetadata(single, 'X').description).toContain('1 trap type beat by X');
  });
});
