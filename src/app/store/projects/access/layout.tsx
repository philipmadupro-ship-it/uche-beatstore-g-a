import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Private project access — U2C Beatstore',
  robots: { index: false, follow: false, noarchive: true },
};

export default function ProjectAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
