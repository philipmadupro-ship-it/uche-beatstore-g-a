/**
 * POST …/finance/advances/[advanceId]/void (LABEL-64). `finance.write`.
 *
 * Voids an advance entered by mistake. Refused (409 `advance_referenced`) once a recoupment or a
 * statement uses it. Audited (advance.voided). A void advance is final and counts for nothing.
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { assertAdvancesSchema, readAdvance } from '@/lib/labelos/finance-dashboard-store';
import { json } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.advance.void');

type Params = { params: Promise<{ orgId: string; advanceId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, advanceId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  if (!isUUID(advanceId)) return json(404, { error: 'Advance not found' });
  try {
    await assertAdvancesSchema(access.admin);
    const before = await readAdvance(access.admin, access.orgId, advanceId, access.artistScope);
    if (!before) return json(404, { error: 'Advance not found' });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'advanceVoid', { p_org: access.orgId, p_actor: access.userId, p_advance: before.id, p_payload: {} }),
      'advance void',
    );
    if (out.error === 'advance_referenced') return json(409, { error: 'This advance has been recouped from or is on a statement, so it cannot be voided.', code: 'advance_referenced' });
    if (out.error === 'already_void') return json(409, { error: 'This advance is already void.', code: 'already_void' });
    if (out.error) return json(404, { error: 'Advance not found' });
    return json(200, { voided: true });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY + ' Advances also need migration 182.' });
    log.error('advance void failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not void the advance' });
  }
}
