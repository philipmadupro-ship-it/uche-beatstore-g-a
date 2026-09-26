'use client';

import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toggleFavorite as toggleFavoriteApi } from '@/lib/buyer-session';

/**
 * Guest wishlist — visitors save tracks without an account. Backed by
 * localStorage so the saved set survives reloads + new tabs on the
 * same browser. Stored as `string[]` because JSON can't serialize
 * `Set`; we re-hydrate into a Set on read for O(1) `.has()`.
 *
 * Cross-device sync (migration 060): when the buyer has a magic-link
 * token in localStorage, every toggle also fires an API call that
 * mirrors the heart to buyer_favorites. No-op when anonymous.
 */

interface WishlistState {
  ids: string[];
  toggle: (trackId: string) => void;
  clear: () => void;
}

// Exported so tests + non-React callers can read/write the wishlist via
// `useWishlistStore.getState()` without needing a React renderer.
export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (trackId) => {
        const ids = get().ids;
        set({ ids: ids.includes(trackId) ? ids.filter((x) => x !== trackId) : [...ids, trackId] });
        // Fire-and-forget DB sync. Failure is silent — the local
        // localStorage state stays authoritative on this device.
        void toggleFavoriteApi(trackId);
      },
      clear: () => set({ ids: [] }),
    }),
    { name: 'antigravity-wishlist' },
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
