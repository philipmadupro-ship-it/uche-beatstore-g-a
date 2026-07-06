import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Buyer account — U2C Beatstore',
  robots: { index: false, follow: false, noarchive: true },
};

export default function BuyerAccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
