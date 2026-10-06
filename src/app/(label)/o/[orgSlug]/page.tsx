/**
 * `/o/<slug>` — the org Overview (LABEL-18, 07 §2.1): artists × songs by
 * stage and each artist's next release. A server page, authorised with the
 * same `catalog.read` the API uses. A member without it has no roster to
 * look at, so the org's front door stays its members page (as before).
 * "Since your last visit" (LABEL-20) is the activity digest, read here for
 * THIS member (their scope, their visibility); "Needs attention" (LABEL-35)
 * is not here yet. "My work" (LABEL-23) is the member's own open tasks, above the roster.
 */
import { redirect } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { MyWorkPanel } from '@/components/labelos/MyWorkPanel';
import { OrgOverviewView } from '@/components/labelos/OrgOverviewView';
import { OverviewDigest } from '@/components/labelos/OverviewDigest';
import { orgShellFor, requireOrgCapability } from '@/lib/auth/org-access';
import { loadOverviewDigest } from '@/lib/labelos/activity-store';
import { errorMessage } from '@/lib/errors';
import { loadOrgOverview } from '@/lib/labelos/overview-store';
import { createLogger } from '@/lib/log';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const log = createLogger('page.org.overview');

export default async function OrgHome({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  const access = await requireOrgCapability(shell.org.id, 'catalog.read');
  if (!access.ok) redirect(`/o/${encodeURIComponent(orgSlug)}/settings/members`);
  // The digest is a second reading of the org: if it fails the roster still shows.
  const [overview, digest] = await Promise.all([
    loadOrgOverview(access),
    loadOverviewDigest(access).catch((err) => {
      log.error('overview digest failed', { orgId: shell.org.id, error: errorMessage(err) });
      return null;
    }),
  ]);
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
      <MyWorkPanel orgId={shell.org.id} orgSlug={shell.org.slug} />
      <OrgOverviewView orgSlug={shell.org.slug} overview={overview} limited={limited} />
      {digest && <OverviewDigest orgId={shell.org.id} orgSlug={shell.org.slug} viewerId={access.userId} feed={digest.feed} since={digest.since} lastSeenAt={digest.lastSeenAt} />}
    </PageContainer>
  );
}
