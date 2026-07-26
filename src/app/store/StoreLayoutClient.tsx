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
import { usePathname } from 'next/navigation';

export function StoreLayoutClient({ children }: { children: React.ReactNode }) {
  const { items, removeItem, isOpen, setIsOpen, cartTotal } = useCart();
  const pathname = usePathname();
  const isTransactional = pathname.startsWith('/store/checkout')
    || pathname.startsWith('/store/download')
    || pathname.startsWith('/store/projects/access');

  return (
    <div className="min-h-screen">
      <a
        href="#store-main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-md bg-white px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#090907] transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>
      <main id="store-main-content" tabIndex={-1} className={isTransactional ? 'pb-0' : 'pb-28'}>
        {children}
      </main>
      <MediaSessionBridge />
      {!isTransactional && (
        <>
          <PlayerBar />
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
        </>
      )}
    </div>
  );
}
