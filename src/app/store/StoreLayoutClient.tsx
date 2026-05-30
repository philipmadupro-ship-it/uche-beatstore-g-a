'use client';

/**
 * Client portion of /store's layout — extracted so the layout file
 * itself can be a server component and export generateMetadata for
 * the storefront's social cards (migration 055).
 *
 * Mounts the PlayerBar + MediaSessionBridge + CartDrawer +
 * FloatingCartButton, all of which need the useCart Zustand store
 * (browser-only). The /store route group is outside the dashboard
 * group's auth, so we re-mount these here for the public surface.
 */

import { PlayerBar } from '@/components/player/PlayerBar';
import { MediaSessionBridge } from '@/components/player/MediaSessionBridge';
import { VoiceTagPlayer } from '@/components/player/VoiceTagPlayer';
import { CartDrawer, FloatingCartButton } from '@/components/store/CartDrawer';
import { InstallAppButton } from '@/components/store/InstallAppButton';
import { useCart } from '@/hooks/useCart';

export function StoreLayoutClient({ children }: { children: React.ReactNode }) {
  const { items, removeItem, isOpen, setIsOpen, cartTotal } = useCart();

  return (
    <div className="min-h-screen">
      <main className="pb-28">
        {children}
      </main>
      <PlayerBar />
      <MediaSessionBridge />
      <VoiceTagPlayer />
      <FloatingCartButton />
      <InstallAppButton />
      <CartDrawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        items={items}
        removeItem={removeItem}
        total={cartTotal()}
      />
    </div>
  );
}
