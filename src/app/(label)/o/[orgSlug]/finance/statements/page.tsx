/**
 * `/o/<slug>/finance/statements` — statements and payment tracking (LABEL-63). The page is the shell
 * around `StatementsView`, which loads the statement routes itself: what each viewer is sent is
 * decided there. Staff with `finance.read` see the org's statements; the payee's own artist sees only
 * what was issued to them. A producer org gets a real 404, and so does an org not licensed for the
 * finance module (the routes answer 404 and the view shows the failure).
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { StatementsView } from '@/components/labelos/StatementsView';
import { orgShellFor } from '@/lib/auth/org-access';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function StatementsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer') notFound();
  const staff = shell.capabilities.includes('finance.read') && shell.role !== 'artist';
  // A roster artist, or the owner of an artist org, reads their own issued statements.
  if (!staff && shell.role !== 'artist' && shell.role !== 'owner') notFound();
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Statements</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          {staff
            ? 'A statement per payee per period: earnings less the advances already recouped. Approve it, issue it, then record the payments made outside this system.'
            : 'What has been issued to you: your earnings per period, less any advance recouped, and what has been paid.'}
        </p>
      </header>
      <StatementsView orgId={shell.org.id} />
    </PageContainer>
  );
}
