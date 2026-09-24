import { describe, it, expect } from 'vitest';
import { filterAndSortContacts, matchesCategory, activeContactFilterCount, paginate, pageCount, type ContactLike, type ContactFilterState, type ContactFilterContext } from './filters';

let seq = 0;
function make(p: Partial<ContactLike> = {}): ContactLike {
  seq++;
  return { id: p.id ?? `c${seq}`, name: p.name ?? `Contact ${seq}`, created_at: p.created_at ?? `2024-01-${String(seq).padStart(2, '0')}T00:00:00Z`, tags: p.tags ?? [], ...p };
}
function state(o: Partial<Omit<ContactFilterState, 'tags'>> & { tags?: string[] } = {}): ContactFilterState {
  return { search: o.search ?? '', category: o.category ?? 'all', status: o.status ?? 'all', sort: o.sort ?? 'recent', tags: new Set(o.tags ?? []) };
}
const emptyCtx: ContactFilterContext = { lastSentByContact: new Map(), needsNudgeIds: new Set() };

describe('matchesCategory', () => {
  it('matches buyers by category', () => {
    expect(matchesCategory(make({ category: 'buyer' }), 'buyers', new Set())).toBe(true);
    expect(matchesCategory(make({ category: 'rapper' }), 'buyers', new Set())).toBe(false);
  });
  it('matches rappers by role keywords', () => {
    expect(matchesCategory(make({ role: 'Singer / Artist' }), 'rappers', new Set())).toBe(true);
  });
  it('nudge uses the needs-nudge set', () => {
    expect(matchesCategory(make({ id: 'x' }), 'nudge', new Set(['x']))).toBe(true);
    expect(matchesCategory(make({ id: 'y' }), 'nudge', new Set(['x']))).toBe(false);
  });
});

describe('filterAndSortContacts', () => {
  it('passes all with defaults', () => {
    expect(filterAndSortContacts([make(), make()], state(), emptyCtx)).toHaveLength(2);
  });
  it('filters by tags (AND)', () => {
    const list = [make({ id: 'a', tags: [{ tag: 'drill' }, { tag: 'vip' }] }), make({ id: 'b', tags: [{ tag: 'drill' }] })];
    expect(filterAndSortContacts(list, state({ tags: ['drill', 'vip'] }), emptyCtx).map((c) => c.id)).toEqual(['a']);
  });
  it('search matches tags too', () => {
    const list = [make({ id: 'a', name: 'Bob', tags: [] }), make({ id: 'b', name: 'Sue', tags: [{ tag: 'atlanta' }] })];
    expect(filterAndSortContacts(list, state({ search: 'atl' }), emptyCtx).map((c) => c.id)).toEqual(['b']);
  });
  it('engagement status filter', () => {
    const recent = new Date().toISOString();
    const ctx: ContactFilterContext = { lastSentByContact: new Map([['a', recent]]), needsNudgeIds: new Set() };
    const list = [make({ id: 'a' }), make({ id: 'b' })];
    expect(filterAndSortContacts(list, state({ status: 'active' }), ctx).map((c) => c.id)).toEqual(['a']);
    expect(filterAndSortContacts(list, state({ status: 'cold' }), ctx).map((c) => c.id)).toEqual(['b']);
  });
  it('sorts by name', () => {
    const list = [make({ id: 'a', name: 'Zoe' }), make({ id: 'b', name: 'Abe' })];
    expect(filterAndSortContacts(list, state({ sort: 'name' }), emptyCtx).map((c) => c.id)).toEqual(['b', 'a']);
  });
  it('sorts by lastSent desc by default', () => {
    const ctx: ContactFilterContext = { lastSentByContact: new Map([['a', '2024-01-01'], ['b', '2024-06-01']]), needsNudgeIds: new Set() };
    const list = [make({ id: 'a' }), make({ id: 'b' }), make({ id: 'c' })];
    expect(filterAndSortContacts(list, state({ sort: 'lastSent' }), ctx).map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });
  it('sorts by sends count, respecting sortDir asc', () => {
    const ctx: ContactFilterContext = { lastSentByContact: new Map(), needsNudgeIds: new Set(), sendCountByContact: new Map([['a', 5], ['b', 1], ['c', 3]]) };
    const list = [make({ id: 'a' }), make({ id: 'b' }), make({ id: 'c' })];
    expect(filterAndSortContacts(list, { ...state({ sort: 'sends' }), sortDir: 'asc' }, ctx).map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(filterAndSortContacts(list, { ...state({ sort: 'sends' }), sortDir: 'desc' }, ctx).map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
  it('sorts by lead score, hottest first by default', () => {
    const ctx: ContactFilterContext = {
      lastSentByContact: new Map(),
      needsNudgeIds: new Set(),
      leadScoreByContact: new Map([['a', 20], ['b', 90], ['c', 55]]),
    };
    const list = [make({ id: 'a' }), make({ id: 'b' }), make({ id: 'c' })];
    expect(filterAndSortContacts(list, state({ sort: 'lead' }), ctx).map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
  it('activeContactFilterCount', () => {
    expect(activeContactFilterCount(state())).toBe(0);
    expect(activeContactFilterCount(state({ category: 'buyers', tags: ['vip'], search: 'x' }))).toBe(3);
  });
});

describe('paginate', () => {
  const list = Array.from({ length: 47 }, (_, i) => i);
  it('slices 1-indexed pages', () => {
    expect(paginate(list, 1, 25)).toEqual(list.slice(0, 25));
    expect(paginate(list, 2, 25)).toEqual(list.slice(25, 47));
  });
  it('empty for out-of-range page', () => {
    expect(paginate(list, 3, 25)).toEqual([]);
  });
  it('pageCount rounds up, min 1', () => {
    expect(pageCount(47, 25)).toBe(2);
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(50, 25)).toBe(2);
  });
});

describe('filterAndSortContacts — stage / revenue / tags sorts', () => {
  it('stage puts customers first, unstaged last', () => {
    const list = [make({ id: 'p', crm_status: 'prospect' }), make({ id: 'c', crm_status: 'customer' }), make({ id: 'n' })];
    expect(filterAndSortContacts(list, state({ sort: 'stage' }), emptyCtx).map((c) => c.id)).toEqual(['c', 'p', 'n']);
  });
  it('revenue sorts by the lifetime-revenue map, highest first', () => {
    const list = [make({ id: 'a' }), make({ id: 'b' })];
    const ctx = { ...emptyCtx, revenueByContact: new Map([['b', 120], ['a', 30]]) };
    expect(filterAndSortContacts(list, state({ sort: 'revenue' }), ctx).map((c) => c.id)).toEqual(['b', 'a']);
  });
  it('tags sorts most-tagged first', () => {
    const list = [make({ id: 'a' }), make({ id: 'b', tags: [{ tag: 'vip' }, { tag: 'drill' }] as ContactLike['tags'] })];
    expect(filterAndSortContacts(list, state({ sort: 'tags' }), emptyCtx).map((c) => c.id)).toEqual(['b', 'a']);
  });
});
