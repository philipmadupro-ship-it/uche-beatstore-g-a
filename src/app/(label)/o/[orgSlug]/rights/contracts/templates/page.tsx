/**
 * `/o/<slug>/rights/contracts/templates` — the contract template editor
 * (LABEL-57). `contracts.read` to open it; saving needs `contracts.write`
 * (the API decides). 404 for anyone else and for an org not licensed.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ContractTemplatesView } from '@/components/labelos/ContractTemplatesView';
import { orgShellFor } from '@/lib/auth/org-access';
import { canSeeContractTemplates } from '@/lib/labelos/contracts-nav';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function ContractTemplatesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.modules.includes('contracts') || !canSeeContractTemplates(new Set(shell.capabilities))) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Contract templates</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          A starting template for every kind of agreement. Edit the wording and it becomes your own version; contracts already made keep the wording they were made from.{' '}
          <Link className="underline" href={`/o/${orgSlug}/rights/contracts`}>Back to contracts</Link>
        </p>
      </header>
      <ContractTemplatesView orgId={shell.org.id} />
    </PageContainer>
  );
}
