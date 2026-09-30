import type { Metadata } from 'next';

// A portal is a private bearer link: never indexed, never previewed with a referrer.
export const metadata: Metadata = {
  title: 'Your library',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ArtistPortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
