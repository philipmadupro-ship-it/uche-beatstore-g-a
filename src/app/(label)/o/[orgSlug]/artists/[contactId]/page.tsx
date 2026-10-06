/**
 * `/o/<slug>/artists/<contactId>` — one roster artist's org workspace
 * (LABEL-17, 07 §2.2, 17 R12). A server page: the artist is authorised here
 * with requireObjectAccess (row org, artist scope, `catalog.read`), so a
 * member limited to other artists, a producer contact, another org's artist
 * or a missing id all get the real 404 — the same answer as the API.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { OrgArtistWorkspaceTabs } from '@/components/artists/OrgArtistWorkspaceTabs';
import { orgShellFor, requireObjectAccess } from '@/lib/auth/org-access';
import { loadOrgArtistWorkspace } from '@/lib/labelos/org-workspace-store';

export const dynamic = 'force-dynamic';

export default async function OrgArtistPage({ params }: { params: Promise<{ orgSlug: string; contactId: string }> }) {
  const { orgSlug, contactId } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.read', orgId: shell.org.id });
  if (!access.ok) notFound();
  const workspace = await loadOrgArtistWorkspace(access);
  if (!workspace) notFound();

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          <Link href={`/o/${shell.org.slug}/artists`} className="hover:text-white">Artists</Link> · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">
          {workspace.contact.name}
        </h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">Their projects, songs, releases and files in this organization.</p>
      </header>
      <OrgArtistWorkspaceTabs orgId={shell.org.id} orgSlug={shell.org.slug} workspace={workspace} viewerId={access.userId} />
    </PageContainer>
  );
}
