import type { Metadata } from 'next';

// A signing link is a private bearer link: never indexed, never previewed with a referrer.
export const metadata: Metadata = {
  title: 'Sign a contract',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
