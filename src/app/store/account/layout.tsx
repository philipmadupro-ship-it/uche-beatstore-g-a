import type { Metadata } from 'next';
import { PublicArtworkThemeProvider } from '@/components/providers/ArtworkThemeProvider';

export const metadata: Metadata = {
  title: 'Buyer account — U2C Beatstore',
  robots: { index: false, follow: false, noarchive: true },
};

/**
 * The account pages draw track artwork (`BuyerLibraryTile`, My beats rows via
 * `ArtworkFallback`), and `useTagColors` / `useBrandArtwork` read "no provider"
 * as "I am the dashboard" and fetch `/api/tags/colors` and `/api/profile` —
 * producer-only, session-gated. A buyer's page therefore made two failing
 * requests on every load: 401 signed out of the producer's session, and a 403
 * from the producer gate in `src/proxy.ts` for a signed-in buyer. The store
 * layout only wraps its player and cart, not the page, so each public page
 * supplies its own provider; the account pages had none.
 */
export default function BuyerAccountLayout({ children }: { children: React.ReactNode }) {
  return <PublicArtworkThemeProvider>{children}</PublicArtworkThemeProvider>;
}
