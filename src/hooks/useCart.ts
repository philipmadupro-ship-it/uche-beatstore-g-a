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
  id: string; // unique ID for the cart item (usually nanoid)
  track: Track;
  license: CartLicense;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  addItem: (track: Track, license: CartLicense) => void;
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
