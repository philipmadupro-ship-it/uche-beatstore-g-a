import { describe, expect, it } from 'vitest';
import { normalizeUpc, releaseIncome } from './release-income';

const B = (n: number) => BigInt(n);
const rel = (id: string, over = {}) => ({ id, title: id.toUpperCase(), state: 'draft', upc: null, release_date: null, contact_id: 'c', ...over });
const line = (id: string, gross: number, over = {}) => ({ id, upc: null, song_track_id: null, gross_minor: gross, currency: 'USD', ...over });

describe('normalizeUpc', () => {
  it('compares digits only, ignoring leading zeros', () => {
    expect(normalizeUpc('0 12345-678905')).toBe('12345678905');
    expect(normalizeUpc(null)).toBe('');
  });
});

describe('releaseIncome', () => {
  const releases = [rel('r1', { upc: '012345678905' }), rel('r2'), rel('r3'), rel('gone', { state: 'cancelled' })];
  const items = [
    { release_id: 'r2', song_track_id: 's2' },
    { release_id: 'r2', song_track_id: 's-shared' },
    { release_id: 'r3', song_track_id: 's-shared' },
    { release_id: 'gone', song_track_id: 's-gone' },
  ];
  const lines = [
    line('l1', 1000, { upc: '12345678905' }),
    line('l2', 500, { song_track_id: 's2' }),
    line('l3', 300, { song_track_id: 's-shared' }),
    line('l4', 200, { song_track_id: 'unknown' }),
    line('l5', 100, { song_track_id: 's-gone' }),
    line('l6', 50, { song_track_id: 's2', currency: 'EUR' }),
  ];
  const royaltiesByLine = new Map([['l1', B(400)], ['l2', B(200)]]);
  const spend = [
    { release_id: 'r1', status: 'spent', amount_minor: 150, currency: 'USD' },
    { release_id: 'r1', status: 'committed', amount_minor: 90, currency: 'USD' },
    { release_id: 'r1', status: 'planned', amount_minor: 9999, currency: 'USD' },
  ];
  const out = releaseIncome({ releases, items, lines, royaltiesByLine, spend, visible: null });

  it('attributes by UPC, then by a song that is on exactly one release', () => {
    const r1 = out.rows.find((r) => r.releaseId === 'r1')!;
    expect(r1).toMatchObject({ gross: B(1000), royalties: B(400), spent: B(150), committed: B(90), margin: B(450) });
    expect(out.rows.find((r) => r.releaseId === 'r2' && r.currency === 'USD')).toMatchObject({ gross: B(500), royalties: B(200), margin: B(300) });
  });

  it('keeps currencies on separate rows', () => {
    expect(out.rows.filter((r) => r.releaseId === 'r2').map((r) => r.currency).sort()).toEqual(['EUR', 'USD']);
  });

  it('does not guess for a song on two releases, nor for an unknown song; a cancelled release gets nothing', () => {
    expect(out.rows.some((r) => r.releaseId === 'r3')).toBe(false);
    expect(out.rows.some((r) => r.releaseId === 'gone')).toBe(false);
    expect(out.unattributed).toEqual([
      { currency: 'USD', kind: 'ambiguous', gross: B(300), lines: 1 },
      { currency: 'USD', kind: 'unmatched', gross: B(300), lines: 2 },
    ]);
  });

  it('planned spend is not a cost', () => {
    expect(out.rows.find((r) => r.releaseId === 'r1')!.spent).toBe(B(150));
  });

  it('a scoped viewer gets only visible releases and NO unattributed totals', () => {
    const scoped = releaseIncome({ releases, items, lines, royaltiesByLine, spend, visible: new Set(['r2']) });
    expect(scoped.rows.map((r) => r.releaseId)).toEqual(['r2', 'r2']);
    expect(scoped.unattributed).toEqual([]);
    expect(scoped.rows.some((r) => r.gross === B(1000))).toBe(false);
  });

  it('a UPC shared by two releases is ambiguous, not the first match', () => {
    const o = releaseIncome({ releases: [rel('a', { upc: '111' }), rel('b', { upc: '111' })], items: [], lines: [line('x', 10, { upc: '111' })], royaltiesByLine: new Map(), spend: [], visible: null });
    expect(o.rows).toEqual([]);
    expect(o.unattributed[0].kind).toBe('ambiguous');
  });
});
