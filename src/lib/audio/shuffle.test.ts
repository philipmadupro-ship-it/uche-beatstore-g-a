import { describe, it, expect } from 'vitest';
import { seededShuffle, buildShuffleOrder, nextInShuffle, newShuffleSeed } from './shuffle';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

describe('seededShuffle', () => {
  it('is deterministic for a given seed', () => {
    expect(seededShuffle(ids, 123)).toEqual(seededShuffle(ids, 123));
  });

  it('produces a different order for different seeds (usually)', () => {
    expect(seededShuffle(ids, 1)).not.toEqual(seededShuffle(ids, 2));
  });

  it('is a permutation — every item exactly once, no loss, no dupes', () => {
    const out = seededShuffle(ids, 999);
    expect(out.slice().sort()).toEqual(ids.slice().sort());
    expect(new Set(out).size).toBe(ids.length);
  });

  it('does not mutate the input', () => {
    const copy = ids.slice();
    seededShuffle(ids, 5);
    expect(ids).toEqual(copy);
  });

  it('handles empty and single-item arrays', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(['x'], 1)).toEqual(['x']);
  });
});

describe('buildShuffleOrder', () => {
  it('pulls the current track to the front and keeps a full permutation', () => {
    const order = buildShuffleOrder(ids, 42, 'e');
    expect(order[0]).toBe('e');
    expect(order.slice().sort()).toEqual(ids.slice().sort());
  });

  it('returns a plain shuffle when current is absent or null', () => {
    expect(buildShuffleOrder(ids, 42, null)).toEqual(seededShuffle(ids, 42));
    expect(buildShuffleOrder(ids, 42, 'zzz')).toEqual(seededShuffle(ids, 42));
  });
});

describe('nextInShuffle — no repeats until the bag is exhausted', () => {
  it('walks the whole bag once with no repeats, then signals exhaustion', () => {
    const order = buildShuffleOrder(ids, 7, 'a');
    const played: string[] = [order[0]];
    let cur: string | null = order[0];
    for (;;) {
      const nxt = nextInShuffle(order, cur);
      if (nxt === null) break;
      played.push(nxt);
      cur = nxt;
    }
    // Every track played exactly once before exhaustion.
    expect(played.slice().sort()).toEqual(ids.slice().sort());
    expect(new Set(played).size).toBe(ids.length);
    // Past the end → null (caller reshuffles for repeat-all, else stops).
    expect(nextInShuffle(order, played[played.length - 1])).toBeNull();
  });
});

describe('newShuffleSeed', () => {
  it('returns a positive 32-bit integer', () => {
    const s = newShuffleSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});
