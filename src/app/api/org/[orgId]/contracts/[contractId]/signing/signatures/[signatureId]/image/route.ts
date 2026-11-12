/**
 * GET /api/org/[orgId]/contracts/[contractId]/signing/signatures/[signatureId]/image
 * (LABEL-60) — a DRAWN signature's PNG, for the certificate. Anyone who may
 * read the contract (`mayReadContract`) may see how it was signed. The image
 * lives in the PRIVATE bucket under the org's prefix and is streamed here;
 * its reference and any URL never reach a browser. `no-store`, `nosniff`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { SigningNotReadyError, readSignatures } from '@/lib/labelos/contract-signing-store';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { ContractsNotReadyError } from '@/lib/labelos/contracts-store';
import { streamProjectAsset } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.signing.image');
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string; contractId: string; signatureId: string }> }) {
  const { orgId, contractId, signatureId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Contracts need Supabase.' }, { status: 501 });
  const access = await requireOrgModule(orgId, 'contracts');
  if (!access.ok) return access.res;
  if (!isUUID(contractId) || !isUUID(signatureId)) return notFound();
  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded) return notFound();
    const sig = (await readSignatures(access.admin, access.orgId, loaded.row.id)).find((s) => s.id === signatureId);
    if (!sig?.imageRef) return notFound();
    return await streamProjectAsset(req, sig.imageRef, { fileName: 'signature.png', mime: 'image/png', inline: true });
  } catch (err) {
    if (err instanceof SigningNotReadyError || err instanceof ContractsNotReadyError) return notFound();
    log.error('signature image failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the signature' }, { status: 500 });
  }
}
