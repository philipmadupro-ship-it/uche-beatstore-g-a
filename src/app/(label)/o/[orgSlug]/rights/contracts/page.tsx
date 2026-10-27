/**
 * `/o/<slug>/rights/contracts` — the org's contracts (LABEL-57). The shell
 * around `ContractsView`, which loads `GET /api/org/[orgId]/contracts` itself:
 * what each viewer is sent is decided there. A member with no reason to be
 * here, an org not licensed for contracts and a producer org get a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ContractsView } from '@/components/labelos/ContractsView';
import { orgShellFor } from '@/lib/auth/org-access';
import { canSeeContracts } from '@/lib/labelos/contracts-nav';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function ContractsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.modules.includes('contracts') || !canSeeContracts(new Set(shell.capabilities))) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Contracts</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Agreements with your artists and partners, started from a template for each kind of deal.
        </p>
      </header>
      <ContractsView orgId={shell.org.id} />
    </PageContainer>
  );
}
