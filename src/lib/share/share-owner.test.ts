import { describe, it, expect } from 'vitest';
import { grantableTrackIds, projectShareOwnerId, shareGrantsTrack } from './share-owner';

const TRACK_OWNER: Record<string, string> = { t1: 'producer-1', t2: 'producer-1', t9: 'buyer-1' };
const PRODUCERS = new Set(['producer-1']);
const PARENT_OWNER: Record<string, string> = { proj: 'producer-1', 'buyer-pl': 'buyer-1' };

function fakeAdmin() {
  return {
    from(table: string) {
      const f: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { f[c] = v; return chain; },
        in: (c: string, v: unknown) => { f[c] = v; return chain; },
        maybeSingle: async () => {
          if (table === 'creator_profiles') return { data: PRODUCERS.has(String(f.user_id)) ? { user_id: f.user_id } : null };
          const owner = PARENT_OWNER[String(f.id)] ?? TRACK_OWNER[String(f.id)];
          return { data: owner ? { user_id: owner } : null };
        },
        then: (res: (v: unknown) => unknown) => {
          const ids = (f.id as string[]) ?? [];
          return Promise.resolve({ data: ids.filter((id) => TRACK_OWNER[id] === f.user_id).map((id) => ({ id })) }).then(res);
        },
      };
      return chain;
    },
  };
}

describe('share ownership', () => {
  it("grants only the producer's own tracks from the producer's share", async () => {
    expect(await grantableTrackIds(fakeAdmin(), 'producer-1', ['t1', 't9', 't2'])).toEqual(['t1', 't2']);
  });
  it("a buyer-owned share grants nothing — not even the producer's tracks it lists", async () => {
    expect(await grantableTrackIds(fakeAdmin(), 'buyer-1', ['t1', 't2', 't9'])).toEqual([]);
    expect(await shareGrantsTrack(fakeAdmin(), 'buyer-1', 't1')).toBe(false);
  });
  it('an ownerless share grants nothing', async () => {
    expect(await shareGrantsTrack(fakeAdmin(), null, 't1')).toBe(false);
  });
  it('resolves project_shares owner from the parent row', async () => {
    expect(await projectShareOwnerId(fakeAdmin(), { content_type: 'project', project_id: 'proj' })).toBe('producer-1');
    expect(await projectShareOwnerId(fakeAdmin(), { content_type: 'playlist', playlist_id: 'buyer-pl' })).toBe('buyer-1');
    expect(await projectShareOwnerId(fakeAdmin(), { content_type: 'track', track_id: 't1' })).toBe('producer-1');
  });
});
