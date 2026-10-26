import { describe, expect, it } from 'vitest';
import {
  HITS_PER_GROUP,
  collectVisible,
  MAX_QUERY_TERMS,
  detectIdentifier,
  groupHits,
  matchRank,
  navigableHits,
  parseSearchQuery,
  rankHits,
  searchHitHref,
  type SearchHit,
} from './org-search';

describe('parseSearchQuery', () => {
  it('turns words into AND-ed prefix terms', () => {
    expect(parseSearchQuery('Runnin Home')).toMatchObject({ terms: ['runnin', 'home'], tsquery: 'runnin:* & home:*', text: 'runnin home' });
  });

  it('keeps no operator, quote or separator a tsquery or a PostgREST filter would read', () => {
    const q = parseSearchQuery(`a&b|c!d(e)f:g'h"i,j.k*l\\m<->n`);
    expect(q.tsquery).toMatch(/^[\p{L}\p{N}:* &]+$/u);
    expect(q.terms).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'].slice(0, MAX_QUERY_TERMS));
  });

  it('is null for nothing searchable', () => {
    for (const raw of ['', '   ', '&|!()', undefined, null, 42]) expect(parseSearchQuery(raw).tsquery).toBeNull();
  });

  it('reads letters of any script and digits', () => {
    expect(parseSearchQuery('Ọmọ Ádé 808').terms).toEqual(['ọmọ', 'ádé', '808']);
  });

  it('caps the length, the number of words and the size of a word', () => {
    expect(parseSearchQuery('x '.repeat(500)).terms).toHaveLength(MAX_QUERY_TERMS);
    expect(parseSearchQuery('y'.repeat(500)).terms[0].length).toBeLessThanOrEqual(40);
  });
});

describe('parseSearchQuery — scripts with combining marks (LABEL-45)', () => {
  it('keeps a Hindi word whole: the vowel signs and the virama are marks, not separators', () => {
    expect(parseSearchQuery('हिन्दी गाना').terms).toEqual(['हिन्दी', 'गाना']);
    expect(parseSearchQuery('हिन्दी').tsquery).toBe('हिन्दी:*');
  });

  it('keeps a Thai word whole', () => {
    expect(parseSearchQuery('สวัสดี').terms).toEqual(['สวัสดี']);
    expect(parseSearchQuery('เพลง ใหม่').terms).toEqual(['เพลง', 'ใหม่']);
  });

  it('keeps an accent written as base + combining mark in one piece', () => {
    expect(parseSearchQuery('Ade\u0301').terms).toEqual(['adé']);
  });

  it('a mark on its own is not a word, and operators are still gone', () => {
    expect(parseSearchQuery('\u0301').tsquery).toBeNull();
    expect(parseSearchQuery('हिन्दी & (गाना)').tsquery).toBe('हिन्दी:* & गाना:*');
  });

  it('ranks a title in those scripts by its words', () => {
    const q = parseSearchQuery('गाना');
    expect(matchRank(q, 'गाना')).toBe(0);
    expect(matchRank(q, 'नया गाना')).toBe(2);
  });

  it('splits file names and addresses the way the index does: _ . - @ / are separators', () => {
    expect(parseSearchQuery('final_mix.wav').terms).toEqual(['final', 'mix', 'wav']);
    expect(parseSearchQuery('a@x.com').tsquery).toBe('a:* & x:* & com:*');
    expect(parseSearchQuery('x com').tsquery).toBe('x:* & com:*');
  });
});

describe('collectVisible — paging until enough visible hits (LABEL-45)', () => {
  const source = (total: number) => {
    const reads: number[] = [];
    const read = async (from: number, to: number) => {
      reads.push(from);
      return Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i);
    };
    return { read, reads };
  };
  const evens = async (rows: number[]) => rows.filter((n) => n % 2 === 0);

  it('stops at the first page when it already holds enough', async () => {
    const s = source(500);
    const hits = await collectVisible([s.read], evens, (h) => h.length >= 6, { pageSize: 40 });
    expect(hits.length).toBe(20);
    expect(s.reads).toEqual([0]);
  });

  it('keeps paging past pages that are entirely hidden, so common words do not starve a scoped member', async () => {
    const s = source(500);
    const hits = await collectVisible([s.read], async (rows) => rows.filter((n) => n >= 130 && n < 140), (h) => h.length >= 6, { pageSize: 40 });
    expect(hits).toEqual([130, 131, 132, 133, 134, 135, 136, 137, 138, 139]);
    expect(s.reads).toEqual([0, 40, 80, 120]);
  });

  it('stops on a short page: the source is exhausted', async () => {
    const s = source(50);
    const hits = await collectVisible([s.read], async () => [], () => false, { pageSize: 40 });
    expect(hits).toEqual([]);
    expect(s.reads).toEqual([0, 40]);
  });

  it('is bounded: at most maxExtraPages beyond a source\'s first page, however much is hidden', async () => {
    const s = source(100000);
    await collectVisible([s.read], async () => [], () => false, { pageSize: 40, maxExtraPages: 3 });
    expect(s.reads).toEqual([0, 40, 80, 120]);
  });

  it('reads every source\'s first page (a scope split into id chunks loses nothing) but pages no further than the budget', async () => {
    const a = source(100000), b = source(10), c = source(100000);
    const hits = await collectVisible([a.read, b.read, c.read], async (rows) => rows.filter((n) => n === 0), () => false, { pageSize: 40, maxExtraPages: 2 });
    expect(a.reads).toEqual([0, 40, 80]);
    expect(b.reads).toEqual([0]);
    expect(c.reads).toEqual([0]);
    expect(hits).toEqual([0, 0, 0]);
  });

  it('still reads every source\'s first page when an earlier one had enough, but pages no further', async () => {
    const a = source(100), b = source(100);
    const hits = await collectVisible([a.read, b.read], async (rows) => rows, (h) => h.length >= 6, { pageSize: 40 });
    expect(a.reads).toEqual([0]);
    expect(b.reads).toEqual([0]);
    expect(hits.length).toBe(80);
  });
});

describe('detectIdentifier', () => {
  it('recognises each code in its usual spellings', () => {
    expect(detectIdentifier('GBAYE0601498')).toEqual({ kind: 'isrc', value: 'GBAYE0601498' });
    expect(detectIdentifier(' gb-aye-06-01498 ')).toEqual({ kind: 'isrc', value: 'GBAYE0601498' });
    expect(detectIdentifier('036000291452')).toEqual({ kind: 'upc', value: '036000291452' });
    expect(detectIdentifier('T-034.524.680-1')).toEqual({ kind: 'iswc', value: 'T-034.524.680-1' });
    expect(detectIdentifier('t0345246801')).toEqual({ kind: 'iswc', value: 'T-034.524.680-1' });
    expect(detectIdentifier('001 234 567 89')).toEqual({ kind: 'ipi', value: '00123456789' });
  });

  it('is not a title that happens to look like a code, or a code with a wrong check digit', () => {
    for (const q of ['Runnin Home', 'Moonlight', '808', '036000291453', 'T-034.524.680-2', 'GBAYE06014', 'GBAYE0601498 remix', '']) {
      expect(detectIdentifier(q)).toBeNull();
    }
    expect(detectIdentifier(undefined)).toBeNull();
  });
});

const hit = (group: SearchHit['group'], id: string, title: string, projectId?: string): SearchHit => ({ group, id, title, sub: null, projectId });

describe('ranking and grouping', () => {
  const q = parseSearchQuery('run');

  it('exact, then prefix, then word-prefix, then the rest; ties alphabetical, then id', () => {
    expect(matchRank(parseSearchQuery('run'), 'Run')).toBe(0);
    expect(matchRank(parseSearchQuery('run'), 'Runnin')).toBe(1);
    expect(matchRank(parseSearchQuery('run'), 'Late Runnin')).toBe(2);
    expect(matchRank(parseSearchQuery('run'), 'Prune')).toBe(3);
    const ranked = rankHits(q, [hit('songs', 'c', 'Late Runnin'), hit('songs', 'b', 'Runnin'), hit('songs', 'a', 'Runnin'), hit('songs', 'd', 'Run')]);
    expect(ranked.map((h) => h.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('does not depend on arrival order', () => {
    const hits = [hit('songs', '1', 'Runnin B'), hit('songs', '2', 'Runnin A'), hit('songs', '3', 'Run')];
    expect(rankHits(q, hits)).toEqual(rankHits(q, [...hits].reverse()));
  });

  it('groups in display order, drops empty groups, caps each', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit('songs', `s${i}`, `Run ${i}`));
    const groups = groupHits(q, [hit('projects', 'p', 'Run EP'), ...many, hit('artists', 'a', 'Run DMC'), hit('files', 'f', 'Run art', 'p')]);
    expect(groups.map((g) => g.group)).toEqual(['artists', 'songs', 'projects', 'files']);
    expect(groups[1].hits).toHaveLength(HITS_PER_GROUP);
  });
});

describe('links', () => {
  it('maps a hit to the org page that exists', () => {
    expect(searchHitHref('label-a', hit('artists', 'c1', 'x'))).toBe('/o/label-a/artists/c1');
    expect(searchHitHref('label-a', hit('songs', 's1', 'x'))).toBe('/o/label-a/songs/s1');
    expect(searchHitHref('label-a', hit('releases', 'r1', 'x'))).toBe('/o/label-a/releases/r1');
    expect(searchHitHref('label-a', hit('projects', 'p1', 'x'))).toBe('/o/label-a/projects/p1');
    expect(searchHitHref('label-a', hit('files', 'f1', 'x', 'p1'))).toBe('/o/label-a/projects/p1');
  });

  it('people have no page yet, and the keyboard skips them', () => {
    expect(searchHitHref('label-a', hit('people', 'x', 'x'))).toBeNull();
    const result = { jump: null, groups: [{ group: 'people' as const, hits: [hit('people', 'x', 'x')] }, { group: 'songs' as const, hits: [hit('songs', 's', 's')] }] };
    expect(navigableHits(result, 'label-a').map((h) => h.id)).toEqual(['s']);
  });
});
