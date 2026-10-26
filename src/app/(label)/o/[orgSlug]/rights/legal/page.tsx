/**
 * `/o/<slug>/rights/legal` — the legal queue (LABEL-31, 09 §3.3, 07 §2).
 * The page is the shell around `LegalQueueView`, which loads
 * `GET /api/org/[orgId]/legal/queue` itself. A member who does not work the
 * queue (the legal gate or the contracts, plus the catalogue) gets a real 404,
 * and so does everyone in an org not licensed for the contracts module.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { LegalQueueView } from '@/components/labelos/LegalQueueView';
import { orgShellFor } from '@/lib/auth/org-access';
import { canSeeLegalQueue } from '@/lib/labelos/legal-queue';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function LegalQueuePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  // The queue is part of the contracts module (LABEL-47): not licensed, not there.
  if (!shell || shell.org.kind === 'producer' || !shell.modules.includes('contracts') || !canSeeLegalQueue(new Set(shell.capabilities))) notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Legal queue</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">Songs and releases waiting for legal. Ready ones first, then the longest waiting.</p>
      </header>
      <LegalQueueView orgId={shell.org.id} orgSlug={shell.org.slug} />
    </PageContainer>
  );
}
