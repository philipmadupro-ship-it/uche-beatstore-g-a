/**
 * `/o/<slug>/releases/store` — Store listings (LABEL-71). Two things, each
 * shown only to the person it is for:
 *
 *  - "Asked of you": releases on which an account that stands for you as an
 *    artist is credited and the label or studio has put (or proposed to put)
 *    on the public store. You say yes or no; a no takes the release off the
 *    store at once and keeps it off until you say yes. Any member opens the
 *    page; one who is nobody's artist sees that nothing is waiting.
 *  - "Releases from connected artists": the store owner's list of the music
 *    connected artists have put on their store, with Unlist. The owner of a
 *    label org only; the API re-checks that they own the store.
 *
 * Every rule is the server's (`/api/org/[orgId]/consents`, `…/connected-releases`).
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { StoreListingsView } from '@/components/labelos/StoreListingsView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function StoreListingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Store listings</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          The artist always has the final say on putting their music on the store.
        </p>
      </header>
      <StoreListingsView orgId={shell.org.id} showConnected={shell.org.kind === 'label' && shell.role === 'owner'} />
    </PageContainer>
  );
}
