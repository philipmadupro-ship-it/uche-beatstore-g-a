/**
 * `/o/<slug>/rights/contracts/<id>/certificate` — the signature certificate of
 * one contract (LABEL-60). Same gate as the contract page; what the viewer is
 * shown is decided by `GET …/signing` (`mayReadContract`).
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ContractCertificate } from '@/components/labelos/ContractCertificate';
import { orgShellFor } from '@/lib/auth/org-access';
import { canSeeContracts } from '@/lib/labelos/contracts-nav';
import { isUUID } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export default async function ContractCertificatePage({ params }: { params: Promise<{ orgSlug: string; contractId: string }> }) {
  const { orgSlug, contractId } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || shell.org.kind === 'producer' || !shell.modules.includes('contracts') || !canSeeContracts(new Set(shell.capabilities)) || !isUUID(contractId)) notFound();
  return (
    <PageContainer>
      <ContractCertificate orgId={shell.org.id} contractId={contractId} />
    </PageContainer>
  );
}
