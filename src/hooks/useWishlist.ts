'use client';

import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  buyerIdentityQuery,
  fetchBuyerFavoriteIds,
  setFavorite as setFavoriteApi,
} from '@/lib/buyer-session';
import { reconcileFavorites } from '@/lib/store/favorites-sync';

/**
 * Guest wishlist — visitors save tracks without an account. Backed by
 * localStorage so the saved set survives reloads + new tabs on the
 * same browser. Stored as `string[]` because JSON can't serialize
 * `Set`; we re-hydrate into a Set on read for O(1) `.has()`.
 *
 * Cross-device sync (migration 060): when the device has a buyer identity
 * (signed-in account or magic-link token), every toggle also mirrors the
 * heart's NEW state to buyer_favorites, and `syncWithAccount` pulls the
 * account's hearts back in (lib/store/favorites-sync.ts). No-op when
 * anonymous.
 */

interface WishlistState {
  ids: string[];
  toggle: (trackId: string) => void;
  clear: () => void;
  /** Merge the account's favourites in; push local-only hearts up. */
  syncWithAccount: () => Promise<void>;
}

/** Identity the wishlist last synced against, so a sync runs once per identity. */
let syncedIdentity: string | null = null;

/** Tests only. */
export function resetWishlistSyncForTests(): void {
  syncedIdentity = null;
}

// Exported so tests + non-React callers can read/write the wishlist via
// `useWishlistStore.getState()` without needing a React renderer.
export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (trackId) => {
        const ids = get().ids;
        const favorited = !ids.includes(trackId);
        set({ ids: favorited ? [...ids, trackId] : ids.filter((x) => x !== trackId) });
        // Fire-and-forget DB sync of the state the heart now shows — never
        // a server-side flip, which inverts the heart whenever this device
        // and the account disagree. Failure is silent: the localStorage
        // state stays authoritative on this device.
        void setFavoriteApi(trackId, favorited);
      },
      clear: () => {
        syncedIdentity = null;
        set({ ids: [] });
      },
      syncWithAccount: async () => {
        const identity = buyerIdentityQuery();
        if (!identity) {
          syncedIdentity = null;
          return;
        }
        if (syncedIdentity === identity.query) return;
        syncedIdentity = identity.query;
        const accountIds = await fetchBuyerFavoriteIds();
        if (accountIds === null) {
          // Unknown, not empty — retry on the next navigation.
          syncedIdentity = null;
          return;
        }
        const { ids, toPush } = reconcileFavorites(get().ids, accountIds);
        set({ ids });
        for (const id of toPush) void setFavoriteApi(id, true);
      },
    }),
    // `syncWithAccount` state lives in module scope, not in storage.
    { name: 'antigravity-wishlist', partialize: (s) => ({ ids: s.ids }) },
  ),
);
const store = useWishlistStore;

export function useWishlist(): {
  ids: Set<string>;
  has: (trackId: string) => boolean;
  toggle: (trackId: string) => void;
  count: number;
} {
  const ids = store((s) => s.ids);
  const toggle = store((s) => s.toggle);
  // Stable while the saved list is unchanged. A fresh Set per render made
  // every memo keyed on `ids` recompute on every render — on /store that re-ran
  // the catalogue filter and re-queued preview prefetch each time, so ordinary
  // playback drained the whole catalogue's previews in the background.
  const setIds = useMemo(() => new Set(ids), [ids]);
  const has = useCallback((id: string) => setIds.has(id), [setIds]);
  return { ids: setIds, has, toggle, count: ids.length };
}
