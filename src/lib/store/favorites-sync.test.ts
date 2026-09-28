import { describe, expect, it } from 'vitest';
import { reconcileFavorites } from './favorites-sync';

describe('reconcileFavorites', () => {
  it('pulls account hearts onto a device that has none (second device / cleared browser)', () => {
    expect(reconcileFavorites([], ['a', 'b'])).toEqual({ ids: ['a', 'b'], toPush: [] });
  });

  it('pushes hearts made on this device before signing in, rather than dropping them', () => {
    expect(reconcileFavorites(['guest'], ['a'])).toEqual({ ids: ['guest', 'a'], toPush: ['guest'] });
  });

  it('is a no-op when both sides already agree', () => {
    expect(reconcileFavorites(['a', 'b'], ['b', 'a'])).toEqual({ ids: ['a', 'b'], toPush: [] });
  });

  it('never duplicates an id', () => {
    const { ids, toPush } = reconcileFavorites(['a', 'a', 'c'], ['a', 'b', 'b']);
    expect(ids).toEqual(['a', 'c', 'b']);
    expect(toPush).toEqual(['c']);
  });
});
