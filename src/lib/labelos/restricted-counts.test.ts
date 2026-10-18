import { describe, expect, it } from 'vitest';
import { mayShowRestrictedCounts, restrictedCountFor } from './restricted-counts';

describe('who is told how much is restricted (doc 21 §5 #9)', () => {
  it('whole-org staff are', () => {
    for (const role of ['owner', 'admin', 'member']) {
      expect(mayShowRestrictedCounts({ role, artistScope: null })).toBe(true);
      expect(restrictedCountFor(4, { role, artistScope: null })).toBe(4);
    }
  });

  it('a roster artist is not, whatever their scope says', () => {
    expect(restrictedCountFor(4, { role: 'artist', artistScope: null })).toBe(0);
    expect(restrictedCountFor(4, { role: 'artist', artistScope: new Set(['c1']) })).toBe(0);
  });

  it('staff limited to some artists are not — even a scope that names every artist they have', () => {
    expect(restrictedCountFor(4, { role: 'member', artistScope: new Set(['c1']) })).toBe(0);
    expect(restrictedCountFor(4, { role: 'admin', artistScope: new Set<string>() })).toBe(0);
    expect(restrictedCountFor(4, { role: 'member', artistScope: ['c1'] })).toBe(0);
  });

  it('a hidden count is the number 0, so the payload is the same as for "nothing restricted"', () => {
    expect(restrictedCountFor(0, { role: 'member', artistScope: new Set(['c1']) })).toBe(0);
    expect(JSON.stringify({ restricted: restrictedCountFor(9, { role: 'artist', artistScope: null }) })).toBe(JSON.stringify({ restricted: 0 }));
  });
});
