/**
 * `/o/<slug>/finance` — the finance overview (LABEL-64): positions, income against cost and the
 * periods with their close. The page is the shell around `FinanceDashboardView`, which loads the
 * dashboard route itself. A member without `finance.read` (a roster artist, marketing…), an org
 * not licensed for the finance module, and a producer org get a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { FinanceDashboardView } from '@/components/labelos/FinanceDashboardView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function FinancePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.capabilities.includes('finance.read') || shell.role === 'artist') notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Finance</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Where each payee stands, what each release has earned against what it cost, and which periods are closed. This reads what earnings, statements and advances already recorded; it never moves money.
        </p>
      </header>
      <FinanceDashboardView orgId={shell.org.id} />
    </PageContainer>
  );
}
