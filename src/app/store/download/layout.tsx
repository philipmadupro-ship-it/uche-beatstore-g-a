import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your downloads — U2C Beatstore',
  robots: { index: false, follow: false, noarchive: true },
};

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
