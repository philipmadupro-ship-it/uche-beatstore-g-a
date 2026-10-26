/**
 * `/platform` — license Label OS to an independent artist / producer or to a
 * label, and decide what each licensee gets (LABEL-47). The layout has
 * already answered 404 to anyone who is not a platform operator.
 */
import { PageContainer } from '@/components/layout/PageHeader';
import { PlatformConsole } from '@/components/labelos/PlatformConsole';

export const dynamic = 'force-dynamic';

export default function PlatformPage() {
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Platform console</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Licensees</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Who has Label OS, as which kind of account, with which modules and how many seats. Every change is recorded in that organization’s activity.
        </p>
      </header>
      <PlatformConsole />
    </PageContainer>
  );
}
