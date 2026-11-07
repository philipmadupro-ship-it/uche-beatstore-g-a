/**
 * `/o/<slug>/releases/<id>` — one release (LABEL-33): details, tracklist,
 * artwork, gates and delivery. Authorised here with requireObjectAccess on
 * the release (`catalog.read`; another org's, one outside the member's
 * artists or a missing id is a real 404), then loaded in one server pass
 * (`loadReleaseDetail`). What the member may DO is `detail.me`; the routes
 * re-check every write.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ReleaseDetailView } from '@/components/labelos/ReleaseDetailView';
import { MarketingPlanPanel } from '@/components/labelos/MarketingPlanPanel';
import { PressKitPanel } from '@/components/labelos/PressKitPanel';
import { ReleaseStoreCard } from '@/components/labelos/ReleaseStoreCard';
import { orgHasModule, orgShellFor, requireObjectAccess } from '@/lib/auth/org-access';
import { mayReadPress } from '@/lib/labelos/press';
import { loadReleaseDetail } from '@/lib/labelos/release-detail-store';

export const dynamic = 'force-dynamic';

export default async function ReleasePage({ params }: { params: Promise<{ orgSlug: string; releaseId: string }> }) {
  const { orgSlug, releaseId } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId: shell.org.id });
  if (!access.ok) notFound();
  const detail = await loadReleaseDetail(access);
  if (!detail) notFound();
  return (
    <PageContainer>
      <ReleaseDetailView orgId={shell.org.id} orgSlug={shell.org.slug} detail={detail} />
      {/* LABEL-65: the marketing plan; its routes answer 404 for an org not licensed for marketing, so the section is not drawn there. */}
      {orgHasModule(access, 'marketing') && (
        <div className="mt-6">
          <MarketingPlanPanel orgId={shell.org.id} releaseId={detail.release.id} />
        </div>
      )}
      {/* LABEL-66: the press kit and outreach; its routes answer 404 for an org not licensed for pr (or a role without pr.read), so the section is not drawn there. */}
      {orgHasModule(access, 'pr') && mayReadPress(access.capabilities, access.role) && (
        <div className="mt-6">
          <PressKitPanel orgId={shell.org.id} releaseId={detail.release.id} />
        </div>
      )}
      {/* LABEL-42: released music on the public store; draws nothing where it can never apply. */}
      {detail.release.state === 'delivered' && (
        <div className="mt-6">
          <ReleaseStoreCard orgId={shell.org.id} releaseId={detail.release.id} canWrite={detail.me.canWrite} canManagePublic={detail.me.canManagePublic} imported={detail.release.importedReleased} />
        </div>
      )}
    </PageContainer>
  );
}
