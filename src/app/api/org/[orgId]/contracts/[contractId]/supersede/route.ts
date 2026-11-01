/**
 * POST /api/org/[orgId]/contracts/[contractId]/supersede (LABEL-60).
 *
 * Replace a SENT or SIGNED contract: it is voided (its signing links stop), a
 * DRAFT copy is made — same type, clauses, fields, links and parties, never
 * the internal note — and the two point at each other. The old contract's
 * signatures stay on it as the record; the copy starts unsigned and goes
 * through the editor and "send for signature" like any draft. `{ reason? }`.
 * `contracts.write`, inside the caller's artist scope.
 *
 * One audit function (migration 178) does all of it, with
 * `contract.superseded`, in one transaction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractSupersedeBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { SIGNING_NOT_READY, assertSigningSchema, isMissingSigning, SigningNotReadyError } from '@/lib/labelos/contract-signing-store';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { CONTRACTS_NOT_READY, ContractsNotReadyError } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.supersede');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; contractId: string }> }) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return json(404, { error: 'Contract not found' });
  const parsed = await readBody(req, OrgContractSupersedeBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return json(404, { error: 'Contract not found' });
    await assertSigningSchema(access.admin);
    const { data, error } = await auditRpc(access.admin, 'contractSupersede', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_contract: loaded.row.id,
      p_reason: parsed.data.reason ?? null,
      p_payload: { with_reason: !!parsed.data.reason, version: loaded.row.version },
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingSigning(error)) return json(503, { error: SIGNING_NOT_READY });
      throw new Error(`contract supersede: ${error.message}`);
    }
    if (data?.error === 'not_sent') return json(409, { error: 'Only a contract that was sent for signature, and not yet replaced, can be superseded.' });
    if (data?.error === 'not_found') return json(404, { error: 'Contract not found' });
    return json(200, { ok: true, new_id: data?.new_id ?? null });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    if (err instanceof SigningNotReadyError) return json(503, { error: SIGNING_NOT_READY });
    log.error('contract supersede failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not supersede the contract' });
  }
}
