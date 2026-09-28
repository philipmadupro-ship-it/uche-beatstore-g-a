import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: a signed-in buyer's hearts must survive a refresh, a
 * sign-out/in and a second device (BUYER-02).
 *
 * Before the fix the heart mirrored to the account as `toggle_favorite`, and
 * nothing read the account back. On a device whose wishlist had not seen a
 * heart (phone, cleared browser, after sign-out), the beat showed empty,
 * the buyer tapped it to save it, and the server FLIPPED its stored row —
 * deleting the favourite the buyer had just asked for.
 *
 * `server` below is an email-keyed buyer_favorites stand-in with the real
 * route's semantics for `set_favorite`.
 */
const server = new Set<string>();
let identity: { query: string; mode: 'session' | 'token' } | null = null;
const sent: Array<{ track_id: string; favorited: boolean }> = [];

vi.mock('@/lib/buyer-session', () => ({
  buyerIdentityQuery: () => identity,
  fetchBuyerFavoriteIds: async () => (identity ? [...server] : null),
  setFavorite: async (track_id: string, favorited: boolean) => {
    if (!identity) return { ok: false };
    sent.push({ track_id, favorited });
    if (favorited) server.add(track_id);
    else server.delete(track_id);
    return { ok: true };
  },
}));

const { useWishlistStore, resetWishlistSyncForTests } = await import('./useWishlist');
const state = () => useWishlistStore.getState();

beforeEach(() => {
  server.clear();
  sent.length = 0;
  identity = null;
  resetWishlistSyncForTests();
  useWishlistStore.setState({ ids: [] });
});

describe('wishlist ↔ account favourites', () => {
  it('a heart tapped on a device that has not synced saves it, never deletes it', () => {
    identity = { query: 'session=1', mode: 'session' };
    server.add('beat'); // saved earlier on the laptop
    state().toggle('beat'); // phone shows it empty; buyer taps to save
    expect(sent).toEqual([{ track_id: 'beat', favorited: true }]);
    expect(server.has('beat')).toBe(true);
  });

  it('pulls the account hearts in after sign-in, so the heart shows filled', async () => {
    server.add('a');
    server.add('b');
    identity = { query: 'session=1', mode: 'session' };
    await state().syncWithAccount();
    expect([...state().ids].sort()).toEqual(['a', 'b']);
  });

  it('favourite → refresh → sign out → sign in: the account still has it', async () => {
    identity = { query: 'session=1', mode: 'session' };
    await state().syncWithAccount();
    state().toggle('fav');
    expect(server.has('fav')).toBe(true);

    // Sign out: /store/account/me clears identity + local wishlist.
    identity = null;
    state().clear();
    expect(state().ids).toEqual([]);
    expect(server.has('fav')).toBe(true);

    // Sign back in, next /store navigation syncs.
    identity = { query: 'session=1', mode: 'session' };
    await state().syncWithAccount();
    expect(state().ids).toEqual(['fav']);
  });

  it('pushes hearts made as a guest up to the account on sign-in', async () => {
    state().toggle('guest-heart'); // anonymous: nothing sent
    expect(sent).toEqual([]);
    identity = { query: 'session=1', mode: 'session' };
    await state().syncWithAccount();
    expect(server.has('guest-heart')).toBe(true);
  });

  it('syncs once per identity, not on every navigation', async () => {
    identity = { query: 'session=1', mode: 'session' };
    await state().syncWithAccount();
    server.add('later');
    await state().syncWithAccount();
    expect(state().ids).toEqual([]);
  });

  it('is a no-op for an anonymous visitor', async () => {
    state().toggle('x');
    await state().syncWithAccount();
    expect(state().ids).toEqual(['x']);
    expect(sent).toEqual([]);
  });
});
