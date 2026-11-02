/**
 * `/o/<slug>/creative` — the artistic direction workspace (LABEL-68). The page is the shell around
 * `CreativeWorkspaceView`, which loads `GET /api/org/[orgId]/creative` itself. Needs `creative.read`, which belongs to the
 * artistic department: a member without it, or an org that does not have the department (not licensed, or switched off
 * by the owner — `orgShellFor` has already taken the capability away), gets a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { CreativeWorkspaceView } from '@/components/labelos/CreativeWorkspaceView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function CreativePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.capabilities.includes('creative.read')) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Artistic direction</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">Where each artist’s sound is heading, what is waiting for a creative decision and which releases still need one.</p>
      </header>
      <CreativeWorkspaceView orgId={shell.org.id} orgSlug={shell.org.slug} />
    </PageContainer>
  );
}
