import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Find your order — U2C Beatstore',
  robots: { index: false, follow: false, noarchive: true },
};

export default function StoreOrdersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
