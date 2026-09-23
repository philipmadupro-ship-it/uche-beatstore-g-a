import { describe, expect, it } from 'vitest';
import { pickStoreOwner, rankStoreOwners, type OwnerCandidate } from './owner';

function candidate(over: Partial<OwnerCandidate> & { user_id: string }): OwnerCandidate {
  return { listed_tracks: 0, total_tracks: 0, ...over };
}

describe('pickStoreOwner', () => {
  it('picks the profile that owns the catalogue, not the one that wins a name sort', () => {
    // The real shape of the bug: two profiles, both unnamed, and the orphan
    // sorts first. Scoping the storefront to it serves an empty catalogue.
    const orphan = candidate({ user_id: 'aaaa', display_name: null, total_tracks: 1 });
    const producer = candidate({ user_id: 'zzzz', display_name: null, total_tracks: 651, has_artwork: true });
    expect(pickStoreOwner([orphan, producer])?.user_id).toBe('zzzz');
  });

  it('prefers listed tracks over raw catalogue size', () => {
    const big = candidate({ user_id: 'a', total_tracks: 900, listed_tracks: 0 });
    const selling = candidate({ user_id: 'b', total_tracks: 12, listed_tracks: 12 });
    expect(pickStoreOwner([big, selling])?.user_id).toBe('b');
  });

  it('falls back to a customised profile when neither owns anything', () => {
    const blank = candidate({ user_id: 'a' });
    const branded = candidate({ user_id: 'b', has_artwork: true });
    expect(pickStoreOwner([blank, branded])?.user_id).toBe('b');
  });

  it('prefers a named profile once artwork cannot separate them', () => {
    expect(
      pickStoreOwner([
        candidate({ user_id: 'a', display_name: null }),
        candidate({ user_id: 'b', display_name: 'U2C' }),
      ])?.user_id,
    ).toBe('b');
  });

  it('is deterministic when candidates are otherwise identical', () => {
    // An unstable winner would flip the catalogue between populated and empty
    // as CDN entries expire.
    const a = candidate({ user_id: 'bbb' });
    const b = candidate({ user_id: 'aaa' });
    expect(pickStoreOwner([a, b])?.user_id).toBe('aaa');
    expect(pickStoreOwner([b, a])?.user_id).toBe('aaa');
  });

  it('handles an empty set', () => {
    expect(pickStoreOwner([])).toBeNull();
  });

  it('does not mutate its input', () => {
    const list = [candidate({ user_id: 'b', total_tracks: 1 }), candidate({ user_id: 'a' })];
    rankStoreOwners(list);
    expect(list.map((c) => c.user_id)).toEqual(['b', 'a']);
  });
});
