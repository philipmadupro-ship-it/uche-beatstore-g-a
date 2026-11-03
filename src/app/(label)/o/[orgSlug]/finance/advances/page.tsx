/**
 * `/o/<slug>/finance/advances` — the advances ledger (LABEL-64). The page is the shell around
 * `AdvancesView`, which loads the advances route itself: what each viewer is sent is decided
 * there. A member without `finance.read`, an org not licensed for finance and a producer org get
 * a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { AdvancesView } from '@/components/labelos/AdvancesView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function AdvancesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.capabilities.includes('finance.read') || shell.role === 'artist') notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Advances</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Money paid to a payee up front. A recoupable advance is repaid out of their later earnings; a non-recoupable one is not. Statements show every recoupment.
        </p>
      </header>
      <AdvancesView orgId={shell.org.id} />
    </PageContainer>
  );
}
