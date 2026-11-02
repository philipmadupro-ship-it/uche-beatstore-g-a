/**
 * `/o/<slug>/finance/earnings` — earnings import and the needs-review queue
 * (LABEL-62). The page is the shell around `EarningsView`, which loads the
 * earnings routes itself: what each viewer is sent is decided there. A member
 * without `finance.read` (a roster artist, marketing…), an org not licensed
 * for the finance module, and a producer org get a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { EarningsView } from '@/components/labelos/EarningsView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function EarningsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.capabilities.includes('finance.read') || shell.role === 'artist') notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Earnings</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Import a distributor report, match each line to a recording, and allocate it by the song’s split sheet and any signed contract. Advances are recouped before anyone is owed.
        </p>
      </header>
      <EarningsView orgId={shell.org.id} />
    </PageContainer>
  );
}
