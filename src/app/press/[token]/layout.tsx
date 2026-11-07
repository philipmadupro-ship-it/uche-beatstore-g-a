import type { Metadata } from 'next';

// A press link is a private bearer link: never indexed, never previewed with a referrer.
export const metadata: Metadata = {
  title: 'Press kit',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PressLayout({ children }: { children: React.ReactNode }) {
  return children;
}
