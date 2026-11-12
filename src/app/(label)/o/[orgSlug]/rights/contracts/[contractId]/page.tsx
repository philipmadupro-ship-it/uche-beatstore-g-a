/**
 * `/o/<slug>/rights/contracts/<id>` — one contract (LABEL-58): the field form
 * beside a live preview, clause-level editing, per-version history, the PDF
 * and "Send for signature". The shell around `ContractEditor`, which loads
 * `GET /api/org/[orgId]/contracts/[contractId]` itself: what each viewer is
 * sent is decided there. Same gate as the list page.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ContractEditor } from '@/components/labelos/ContractEditor';
import { orgShellFor } from '@/lib/auth/org-access';
import { canSeeContracts } from '@/lib/labelos/contracts-nav';
import { isUUID } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export default async function ContractPage({ params }: { params: Promise<{ orgSlug: string; contractId: string }> }) {
  const { orgSlug, contractId } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.modules.includes('contracts') || !canSeeContracts(new Set(shell.capabilities)) || !isUUID(contractId)) notFound();
  return (
    <PageContainer>
      <ContractEditor orgId={shell.org.id} contractId={contractId} />
    </PageContainer>
  );
}
