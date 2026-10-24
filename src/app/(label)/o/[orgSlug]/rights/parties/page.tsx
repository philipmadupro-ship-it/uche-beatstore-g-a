/**
 * `/o/<slug>/rights/parties` — the org's rights holders (LABEL-54). The page is
 * the shell around `PartiesView`, which loads `GET /api/org/[orgId]/parties`
 * itself: what each viewer is sent (names only, their own party, the legal
 * block, the payee block) is decided there. A member who reads no party at all
 * gets a real 404, and so does a producer org.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { PartiesView } from '@/components/labelos/PartiesView';
import { orgShellFor } from '@/lib/auth/org-access';
import { canSeeParties } from '@/lib/labelos/parties-view';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function PartiesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !canSeeParties(new Set(shell.capabilities))) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Parties</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Everyone who can be named on a credit or a split sheet: legal details, the collecting society, and how they are paid.
        </p>
      </header>
      <PartiesView orgId={shell.org.id} />
    </PageContainer>
  );
}
