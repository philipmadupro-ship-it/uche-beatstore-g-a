import { describe, expect, it } from 'vitest';
import { moveBy, moveTo } from './release-tracklist';

describe('moving a track', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('moves one step up or down', () => {
    expect(moveBy(order, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveBy(order, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('does nothing at the ends, for an unknown id or for no change', () => {
    expect(moveBy(order, 'a', -1)).toBeNull();
    expect(moveBy(order, 'd', 1)).toBeNull();
    expect(moveBy(order, 'zzz', 1)).toBeNull();
    expect(moveTo(order, 'b', 2)).toBeNull();
  });

  it('moves to an explicit 1-based position, clamped to the list', () => {
    expect(moveTo(order, 'd', 1)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveTo(order, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveTo(order, 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveTo(order, 'c', Number.NaN)).toBeNull();
  });

  it('never mutates its input and keeps every id once', () => {
    const copy = [...order];
    const next = moveTo(order, 'a', 3)!;
    expect(order).toEqual(copy);
    expect([...next].sort()).toEqual(copy);
  });
});
