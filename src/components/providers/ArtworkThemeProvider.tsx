'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  EMPTY_ARTWORK_THEME,
  type PublicArtworkTheme,
} from '@/lib/artwork/public-theme';

/**
 * Supplies the producer's artwork identity to a tree that cannot fetch it.
 *
 * The dashboard's `useBrandArtwork` / `useTagColors` fetch from endpoints that
 * require a session. Public pages — the storefront, share links, the embed —
 * have no session, so they receive the same values alongside their own data
 * and hand them down here.
 *
 * Wrapping is what makes a beat look the same to a buyer as it does to the
 * producer: identical seed, identical palette, identical gradient. Without it
 * the store would generate its artwork from the app accent and the two views
 * of one track would not match.
 */
const ArtworkThemeContext = createContext<PublicArtworkTheme | null>(null);

export function ArtworkThemeProvider({
  theme,
  children,
}: {
  /** Null / undefined renders children unchanged — the hooks keep fetching. */
  theme?: PublicArtworkTheme | null;
  children: ReactNode;
}) {
  // Memoised on the fields rather than object identity: API responses are
  // fresh objects on every refetch, and a new context value re-renders every
  // card that draws generated artwork.
  const value = useMemo<PublicArtworkTheme | null>(() => {
    if (!theme) return null;
    return {
      logo_url: theme.logo_url ?? null,
      artwork: theme.artwork ?? EMPTY_ARTWORK_THEME.artwork,
      tag_colors: theme.tag_colors ?? {},
    };
  }, [theme]);

  if (!value) return <>{children}</>;

  return <ArtworkThemeContext.Provider value={value}>{children}</ArtworkThemeContext.Provider>;
}

/** The supplied theme, or null when the tree is not inside a provider. */
export function useArtworkThemeContext(): PublicArtworkTheme | null {
  return useContext(ArtworkThemeContext);
}

/**
 * The same provider, for public pages that have no producer payload to carry
 * the theme in — checkout, the delivery pages, order lookup.
 *
 * They work from a cart or a purchase token and never load a catalogue, so
 * they fetch the theme from the public endpoint instead. Children render
 * immediately; artwork upgrades from the app accent to the producer's brand
 * when the response lands, which is the right trade for a page whose job is to
 * take a payment.
 */
export function PublicArtworkThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<PublicArtworkTheme | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/store/theme')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.artworkTheme) setTheme(j.artworkTheme as PublicArtworkTheme); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  return <ArtworkThemeProvider theme={theme}>{children}</ArtworkThemeProvider>;
}
