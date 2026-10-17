/**
 * The shell of `/platform` (LABEL-47): the platform operator's console, apart
 * from every org shell and from the producer dashboard. Behind
 * LABEL_OS_ENABLED (the proxy 404s it while the flag is off), and rendered
 * only for a platform operator — everyone else, org owners included, gets a
 * real 404, as if the page did not exist. Per request, never prerendered.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { platformAdminForPage } from '@/lib/auth/platform-access';
import { isLabelOsEnabled } from '@/lib/labelos/flag';

export const dynamic = 'force-dynamic';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!isLabelOsEnabled()) notFound();
  if (!(await platformAdminForPage())) notFound();
  return (
    <div className="min-h-screen bg-[#090907]">
      <header className="fixed left-0 right-0 top-0 z-30 border-b border-white/10 bg-[#090907]/95 backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <Link href="/platform" className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 transition-colors hover:text-white">
            Platform
          </Link>
        </div>
      </header>
      <main className="min-h-screen pb-16 pt-14">{children}</main>
    </div>
  );
}
