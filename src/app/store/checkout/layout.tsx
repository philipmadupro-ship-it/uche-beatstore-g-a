import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Secure checkout — U2C Beatstore',
  robots: { index: false, follow: false, noarchive: true },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
