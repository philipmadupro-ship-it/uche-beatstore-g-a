import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';
import { trackStoreEvent } from '@/lib/store/track-event';
import { licenseAvailability } from '@/lib/store/license-availability';

export interface CartLicense {
  id: string;
  name: string;
  price_usd: number;
  file_types: string[];
  is_exclusive: boolean;
  stems_included?: boolean;
}

export interface CartItem {
  // unique per cart: `${trackId}-${licenseId}-${ts}` (addItem) or
  // `${trackId}-${licenseId}-${ts}-${i}` (addItems bulk; `i` disambiguates
  // sibling adds inside the same millisecond). No nanoid dep.
  id: string;
  track: Track;
  license: CartLicense;
}

export interface BundleRule {
  threshold: number;
  percent: number;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  /** Producer's automatic bundle/quantity discount (mig 077). Set from the
   *  store creator payload; drives the cart-drawer banner. Not persisted. */
  bundleRule: BundleRule | null;
  setBundleRule: (rule: BundleRule | null) => void;
  addItem: (track: Track, license: CartLicense) => boolean;
  /** Bulk add many tracks with the same license tier. Skips duplicates silently. */
  addItems: (pairs: Array<{ track: Track; license: CartLicense }>) => number;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setIsOpen: (isOpen: boolean) => void;
  toggleCart: () => void;
  cartTotal: () => number;
}

const serverStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      bundleRule: null,

      setBundleRule: (rule) => set({ bundleRule: rule }),

      addItem: (track, license) => {
        const availability = licenseAvailability(track, license);
        if (!availability.available) {
          toast.error('License unavailable', availability.message);
          return false;
        }
        // Use functional set so that rapid successive calls (e.g. "Add All")
        // each see the already-updated state, not a stale snapshot.
        let isDuplicate = false;
        set((state) => {
          const currentItems = state.items || [];
          // Dedup by composite key: same track + same license tier = already in cart.
          // Same track with a different license tier is allowed as a separate entry.
          const exactMatch = currentItems.findIndex(
            (i) => i.track?.id === track.id && i.license?.id === license.id,
          );
          if (exactMatch >= 0) {
            isDuplicate = true;
            return { items: currentItems }; // no change
          }
          return {
            items: [
              ...currentItems,
              { id: `${track.id}-${license.id}-${Date.now()}`, track, license },
            ],
            isOpen: true,
          };
        });
        if (isDuplicate) {
          toast.info('Already in cart', `${track.title} (${license.name}) is already added`);
          return false;
        } else {
          // Funnel: a genuine add (not a dup) advances the buyer.
          trackStoreEvent('add_to_cart', {
            track_id: track.id,
            license_id: license.id,
            metadata: { seller_user_id: track.user_id, price_usd: license.price_usd },
          });
          return true;
        }
      },

      addItems: (pairs) => {
        const added: CartItem[] = [];
        const unavailable: string[] = [];
        set((state) => {
          const currentItems = state.items || [];
          const seen = new Set(currentItems.map((i) => `${i.track?.id}-${i.license?.id}`));
          const newItems: CartItem[] = [];
          for (const { track, license } of pairs) {
            const availability = licenseAvailability(track, license);
            if (!availability.available) {
              unavailable.push(track.title);
              continue;
            }
            const key = `${track.id}-${license.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            newItems.push({ id: `${track.id}-${license.id}-${Date.now()}-${newItems.length}`, track, license });
          }
          added.push(...newItems);
          return newItems.length > 0
            ? { items: [...currentItems, ...newItems], isOpen: true }
            : { items: currentItems };
        });
        if (unavailable.length > 0) {
          toast.error(
            'Some licenses unavailable',
            `${unavailable.slice(0, 3).join(', ')}${unavailable.length > 3 ? ` and ${unavailable.length - 3} more` : ''}`,
          );
        }
        // Funnel: one add event per newly-added item (dups already skipped).
        for (const item of added) {
          trackStoreEvent('add_to_cart', {
            track_id: item.track.id,
            license_id: item.license.id,
            metadata: { seller_user_id: item.track.user_id, price_usd: item.license.price_usd, bulk: true },
          });
        }
        return added.length;
      },

      removeItem: (itemId) =>
        set((state) => {
          const removed = state.items.find((i) => i.id === itemId);
          if (removed) {
            trackStoreEvent('remove_from_cart', {
              track_id: removed.track?.id,
              license_id: removed.license?.id,
            });
          }
          return { items: state.items.filter((i) => i.id !== itemId) };
        }),

      clearCart: () => set({ items: [] }),

      setIsOpen: (isOpen) => set({ isOpen }),

      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

      cartTotal: () => {
        return (get().items || []).reduce((total, item) => total + (item.license?.price_usd || 0), 0);
      },
    }),
    {
      name: 'antigravity-cart',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : serverStorage)),
      partialize: (state) => ({ items: state.items }), // Only persist items, not isOpen state
    }
  )
);
