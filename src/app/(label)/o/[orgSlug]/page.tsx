/**
 * `/o/<slug>` — the org Overview (LABEL-18, 07 §2.1): artists × songs by
 * stage and each artist's next release. A server page, authorised with the
 * same `catalog.read` the API uses. A member without it has no roster to
 * look at, so the org's front door stays its members page (as before).
 * "Needs attention" (LABEL-35) and the activity digest (LABEL-20) are not
 * here yet.
 */
import { redirect } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { OrgOverviewView } from '@/components/labelos/OrgOverviewView';
import { orgShellFor, requireOrgCapability } from '@/lib/auth/org-access';
import { loadOrgOverview } from '@/lib/labelos/overview-store';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function OrgHome({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  const access = await requireOrgCapability(shell.org.id, 'catalog.read');
  if (!access.ok) redirect(`/o/${encodeURIComponent(orgSlug)}/settings/members`);
  const overview = await loadOrgOverview(access);
  const limited = access.artistScope !== null;

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">
          Overview
        </h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          {limited ? 'Where the artists you work on stand.' : 'Where every artist on the roster stands.'}
        </p>
      </header>
      <OrgOverviewView orgSlug={shell.org.slug} overview={overview} limited={limited} />
    </PageContainer>
  );
}
