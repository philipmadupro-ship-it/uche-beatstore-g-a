import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';

export interface CartLicense {
  id: string;
  name: string;
  price_usd: number;
  file_types: string[];
  is_exclusive: boolean;
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
  addItem: (track: Track, license: CartLicense) => void;
  /** Bulk add many tracks with the same license tier. Skips duplicates silently. */
  addItems: (pairs: Array<{ track: Track; license: CartLicense }>) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setIsOpen: (isOpen: boolean) => void;
  toggleCart: () => void;
  cartTotal: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      bundleRule: null,

      setBundleRule: (rule) => set({ bundleRule: rule }),

      addItem: (track, license) => {
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
        }
      },

      addItems: (pairs) => {
        set((state) => {
          const currentItems = state.items || [];
          const seen = new Set(currentItems.map((i) => `${i.track?.id}-${i.license?.id}`));
          const newItems: CartItem[] = [];
          for (const { track, license } of pairs) {
            const key = `${track.id}-${license.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            newItems.push({ id: `${track.id}-${license.id}-${Date.now()}-${newItems.length}`, track, license });
          }
          return newItems.length > 0
            ? { items: [...currentItems, ...newItems], isOpen: true }
            : { items: currentItems };
        });
      },

      removeItem: (itemId) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== itemId) })),

      clearCart: () => set({ items: [] }),

      setIsOpen: (isOpen) => set({ isOpen }),

      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

      cartTotal: () => {
        return (get().items || []).reduce((total, item) => total + (item.license?.price_usd || 0), 0);
      },
    }),
    {
      name: 'antigravity-cart',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : (undefined as any))),
      partialize: (state) => ({ items: state.items }), // Only persist items, not isOpen state
    }
  )
);
