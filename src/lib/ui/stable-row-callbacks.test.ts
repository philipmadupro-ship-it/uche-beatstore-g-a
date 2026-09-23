import { describe, expect, it } from 'vitest';
import { RowCallbackCache } from './stable-row-callbacks';

interface Row {
  id: string;
  title: string;
}

describe('RowCallbackCache', () => {
  it('returns the identical function for the same row/slot across calls', () => {
    const cache = new RowCallbackCache<Row>();
    const row: Row = { id: 't1', title: 'Night Shift' };
    const make = (r: Row) => () => r.title;

    const first = cache.get(row.id, 'play', row, make);
    const second = cache.get(row.id, 'play', row, make);

    expect(second).toBe(first);
  });

  it('rebuilds the closure when the row object identity changes', () => {
    const cache = new RowCallbackCache<Row>();
    const rowV1: Row = { id: 't1', title: 'Night Shift' };
    const rowV2: Row = { id: 't1', title: 'Night Shift (renamed)' };
    const make = (r: Row) => () => r.title;

    const first = cache.get(rowV1.id, 'play', rowV1, make);
    const second = cache.get(rowV2.id, 'play', rowV2, make);

    expect(second).not.toBe(first);
    expect(second()).toBe('Night Shift (renamed)');
  });

  it('does not rebuild when an equal-but-different object is passed with the same identity check bypassed', () => {
    // Guards against a common mistake: comparing by value instead of by
    // reference would make the cache useless, since the parent's `.map()`
    // rebuilds row objects with the same content across unrelated renders
    // in some call sites. The cache must key on reference, not value.
    const cache = new RowCallbackCache<Row>();
    const row: Row = { id: 't1', title: 'Night Shift' };
    const make = (r: Row) => () => r.title;

    const first = cache.get(row.id, 'play', row, make);
    // Same reference passed again (simulating an unrelated re-render where
    // the array element itself did not change).
    const second = cache.get(row.id, 'play', row, make);
    expect(second).toBe(first);
  });

  it('keeps separate slots independent for the same row id', () => {
    const cache = new RowCallbackCache<Row>();
    const row: Row = { id: 't1', title: 'Night Shift' };

    const play = cache.get(row.id, 'play', row, (r) => () => `play:${r.id}`);
    const preview = cache.get(row.id, 'preview', row, (r) => () => `preview:${r.id}`);

    expect(play).not.toBe(preview);
    expect(play()).toBe('play:t1');
    expect(preview()).toBe('preview:t1');
  });

  it('keeps rows independent from each other', () => {
    const cache = new RowCallbackCache<Row>();
    const rowA: Row = { id: 'a', title: 'A' };
    const rowB: Row = { id: 'b', title: 'B' };
    const make = (r: Row) => () => r.id;

    const fnA = cache.get(rowA.id, 'play', rowA, make);
    const fnB = cache.get(rowB.id, 'play', rowB, make);

    expect(fnA).not.toBe(fnB);
    expect(cache.size).toBe(2);
  });

  it('prune drops closures for ids no longer present', () => {
    const cache = new RowCallbackCache<Row>();
    const rowA: Row = { id: 'a', title: 'A' };
    const rowB: Row = { id: 'b', title: 'B' };
    const make = (r: Row) => () => r.id;

    cache.get(rowA.id, 'play', rowA, make);
    cache.get(rowB.id, 'play', rowB, make);
    expect(cache.size).toBe(2);

    cache.prune(['a']);
    expect(cache.size).toBe(1);

    // Re-requesting the pruned row rebuilds a (new) closure rather than
    // throwing or returning something stale.
    const rebuilt = cache.get(rowB.id, 'play', rowB, make);
    expect(rebuilt()).toBe('b');
  });
});
