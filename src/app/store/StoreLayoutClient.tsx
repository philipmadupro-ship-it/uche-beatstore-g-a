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
import { useWishlistStore } from '@/hooks/useWishlist';
import { reconcileSessionMarker } from '@/lib/buyer-session';
import { createClient } from '@/lib/supabase/client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { PublicArtworkThemeProvider } from '@/components/providers/ArtworkThemeProvider';

export function StoreLayoutClient({ children }: { children: React.ReactNode }) {
  const { items, removeItem, isOpen, setIsOpen, cartTotal } = useCart();
  const pathname = usePathname();
  const isCheckoutFlow = pathname.startsWith('/store/checkout')
    || pathname.startsWith('/store/download');
  // A bought bundle's delivery page is not a shopping surface (no cart), but
  // it IS a listening one: Play all and every row drive the global player,
  // so the player has to be mounted there or they play nothing.
  const isDelivery = pathname.startsWith('/store/projects/access');

  // Pull a signed-in buyer's account hearts into this browser's wishlist.
  // Keyed on the path because signing in happens inside /store (the account
  // page sets the identity), so the first sync after it is the next
  // navigation. The store no-ops once it has synced for that identity.
  //
  // The device's signed-in marker is first made to agree with the auth
  // cookie (getSession reads it locally, no network): the marker used to be
  // set only by /store/account/me, so a purged localStorage left a signed-in
  // buyer whose hearts never saved or synced.
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        reconcileSessionMarker(Boolean(data.session));
      } catch {
        /* no session info: keep whatever identity the device already holds */
      }
      await useWishlistStore.getState().syncWithAccount();
    })();
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <a
        href="#store-main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-md bg-white px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#090907] transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>
      <main id="store-main-content" tabIndex={-1} className={isCheckoutFlow ? 'pb-0' : 'pb-28'}>
        {children}
      </main>
      <MediaSessionBridge />
      {!isCheckoutFlow && (
        // The player and cart draw track artwork but sit outside every page's
        // provider. Without one, their artwork hooks took the dashboard path
        // and called session-gated endpoints — a 401 for every buyer.
        <PublicArtworkThemeProvider>
          <PlayerBar publicStore />
          {!isDelivery && (
            <>
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
        </PublicArtworkThemeProvider>
      )}
    </div>
  );
}
