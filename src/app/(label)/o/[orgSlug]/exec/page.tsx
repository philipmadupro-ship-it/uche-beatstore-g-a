/**
 * `/o/<slug>/exec` — the executive overview (LABEL-67). A shell around `ExecDashboardView`, which loads the
 * route itself. A member without `exec.read`, an org not licensed for the executive module, a roster
 * artist and an artist or producer org get a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ExecDashboardView } from '@/components/labelos/ExecDashboardView';
import { orgShellFor } from '@/lib/auth/org-access';
import { pageAllowed, viewInputOf } from '@/lib/labelos/role-view';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function ExecPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || !pageAllowed('exec', viewInputOf(shell))) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Executive</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Where the roster stands: the pipeline, what goes out each month, what is stuck, what waits for a decision, and what it earns against what it costs. Read only.
        </p>
      </header>
      <ExecDashboardView orgId={shell.org.id} slug={shell.org.slug} />
    </PageContainer>
  );
}
