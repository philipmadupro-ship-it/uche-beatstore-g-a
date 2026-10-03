/**
 * `/o/<slug>/songs/<trackId>` — song detail (LABEL-17, 07 §2.3). Songs are
 * addressable at org level, so links never need the artist in the path
 * (07 §1). Authorised here with requireObjectAccess on the track, then the
 * same row rule as the API (lib/labelos/org-workspace-store#loadOrgSong):
 * a master, a beat, a working song for marketing, or anything out of scope
 * is a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { OrgSongView } from '@/components/labelos/OrgSongView';
import { orgShellFor, requireObjectAccess } from '@/lib/auth/org-access';
import { loadOrgSong } from '@/lib/labelos/org-workspace-store';

export const dynamic = 'force-dynamic';

export default async function OrgSongPage({ params }: { params: Promise<{ orgSlug: string; trackId: string }> }) {
  const { orgSlug, trackId } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  const access = await requireObjectAccess({ table: 'tracks', id: trackId, cap: 'catalog.read', orgId: shell.org.id });
  if (!access.ok) notFound();
  const detail = await loadOrgSong(access);
  if (!detail) notFound();
  return (
    <PageContainer>
      <OrgSongView orgId={shell.org.id} orgSlug={shell.org.slug} detail={detail} />
    </PageContainer>
  );
}
