/**
 * `/o/<slug>/music` — the org's songs with structured filters and saved views
 * (LABEL-37). The page is a shell: the list is `MusicView`, which asks
 * `/api/org/[orgId]/views/run` for the member's own rows. A member without
 * `catalog.read` gets a real 404, as the other catalogue pages do.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { MusicView } from '@/components/labelos/MusicView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function MusicPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || !shell.capabilities.includes('catalog.read')) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Music</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Every song you can open. Narrow it by stage, artist, credits, splits or what is missing, and save the filters as a view.
        </p>
      </header>
      <MusicView />
    </PageContainer>
  );
}
