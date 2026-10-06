/**
 * `/o/<slug>/ar` — the A&R inbox (LABEL-25, 07 §2.4). The page is the shell
 * around `ArInboxView`, which loads `GET /api/org/[orgId]/ar` itself so a
 * stage move or a review can refresh the queue without a reload. Needs the
 * catalogue: a member without `catalog.read` gets a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ArInboxView } from '@/components/labelos/ArInboxView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function ArInboxPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || !shell.capabilities.includes('catalog.read')) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">A&amp;R inbox</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">Songs waiting for a decision, oldest first.</p>
      </header>
      <ArInboxView orgId={shell.org.id} orgSlug={shell.org.slug} />
    </PageContainer>
  );
}
