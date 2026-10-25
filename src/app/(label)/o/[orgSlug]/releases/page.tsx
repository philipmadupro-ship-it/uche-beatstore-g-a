/**
 * `/o/<slug>/releases` — the release board (LABEL-33, 07 §2.5): a row per
 * release with its gate strip. One server-side read of the readiness
 * (`loadReleaseBoard`), narrowed to the member's artists. Needs the
 * catalogue; a member without `catalog.read` gets a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { FilteredReleaseBoard } from '@/components/labelos/FilteredReleaseBoard';
import { NewReleasePanel } from '@/components/labelos/NewReleasePanel';
import { ReleaseImportPanel } from '@/components/labelos/ReleaseImportPanel';
import { orgShellFor, requireOrgCapability, scopedOrgQuery } from '@/lib/auth/org-access';
import { isBoardFilter } from '@/lib/labelos/release-board';
import { loadReleaseBoard } from '@/lib/labelos/release-board-store';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function ReleaseBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const [{ orgSlug }, { state }] = await Promise.all([params, searchParams]);
  const shell = await orgShellFor(orgSlug);
  if (!shell || !shell.capabilities.includes('catalog.read')) notFound();
  const access = await requireOrgCapability(shell.org.id, 'catalog.read');
  if (!access.ok) notFound();
  const board = await loadReleaseBoard(access);
  // LABEL-42: "already released" is the owner's or an admin's to enter (the route checks again).
  const mayImport = (shell.role === 'owner' || shell.role === 'admin') && shell.capabilities.includes('release.write');
  // LABEL-55: anyone who may write releases starts a draft; "already released" stays the owner's or an admin's.
  const mayCreate = shell.capabilities.includes('release.write');
  const artists = mayCreate
    ? (((await scopedOrgQuery(access.admin, 'contacts', access, 'id, name, category').eq('category', 'artist').order('name', { ascending: true }).limit(200)).data ?? []) as unknown as { id: string; name: string }[])
    : [];
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Releases</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Every release and where its gates stand. Open one to work its tracklist and artwork, or to mark it delivered.
        </p>
      </header>
      {mayCreate && artists.length > 0 && (
        <div className="mb-6 flex flex-wrap items-start gap-2" data-testid="release-create-actions">
          <NewReleasePanel orgId={shell.org.id} orgSlug={shell.org.slug} artists={artists} />
          {mayImport && <ReleaseImportPanel orgId={shell.org.id} orgSlug={shell.org.slug} artists={artists} />}
        </div>
      )}
      <FilteredReleaseBoard
        orgSlug={shell.org.slug}
        releases={board.releases}
        more={board.more}
        schemaReady={board.schemaReady}
        initialFilter={isBoardFilter(state) ? state : 'all'}
      />
    </PageContainer>
  );
}
