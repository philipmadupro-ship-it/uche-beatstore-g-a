'use client';

/**
 * Shared layout for all /store/* routes.
 *
 * The dashboard group layout already wires PlayerBar + MediaSessionBridge,
 * but the store lives outside that group (no auth required). This layout
 * re-mounts them so audio preview works on the public storefront and
 * product pages just like it does inside the dashboard.
 *
 * CartDrawer + FloatingCartButton are rendered here so every store page
 * (grid, product, download portal) shares one cart without each page
 * needing its own drawer.
 */

import { PlayerBar } from '@/components/player/PlayerBar';
import { MediaSessionBridge } from '@/components/player/MediaSessionBridge';
import { CartDrawer, FloatingCartButton } from '@/components/store/CartDrawer';
import { useCart } from '@/hooks/useCart';

function StoreLayoutInner({ children }: { children: React.ReactNode }) {
  const { items, removeItem, isOpen, setIsOpen, cartTotal } = useCart();

  return (
    <div className="min-h-screen">
      <main className="pb-28">
        {children}
      </main>
      <PlayerBar />
      <MediaSessionBridge />
      <FloatingCartButton />
      {isOpen && (
        <CartDrawer
          onClose={() => setIsOpen(false)}
          items={items}
          removeItem={removeItem}
          total={cartTotal()}
        />
      )}
    </div>
  );
}

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <StoreLayoutInner>{children}</StoreLayoutInner>;
}
