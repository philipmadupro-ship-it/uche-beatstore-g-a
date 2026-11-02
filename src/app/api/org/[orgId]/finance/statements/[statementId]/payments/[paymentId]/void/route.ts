/**
 * POST …/finance/statements/[statementId]/payments/[paymentId]/void (LABEL-63). `finance.write`.
 *
 * A recorded payment is never deleted; a wrong one is voided (once) and the statement's position is
 * worked out again without it.
 */
import { NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { json, resolveStatement } from '@/lib/labelos/statement-route';
import { readPayment, rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.payment.void');

type Params = { params: Promise<{ orgId: string; statementId: string; paymentId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, statementId, paymentId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  try {
    const found = await resolveStatement(orgId, statementId, 'finance.write');
    if (!found.ok) return found.res;
    const { access, row } = found.ctx;
    if (!isUUID(paymentId)) return json(404, { error: 'Payment not found' });
    // The payment must be one of THIS statement's.
    const payment = await readPayment(access.admin, access.orgId, paymentId);
    if (!payment || payment.statement_id !== row.id) return json(404, { error: 'Payment not found' });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'paymentVoid', { p_org: access.orgId, p_actor: access.userId, p_payment: payment.id, p_payload: {} }),
      'payment void',
    );
    if (out.error === 'already_void') return json(409, { error: 'That payment is already void.', code: 'already_void' });
    if (out.error) return json(404, { error: 'Payment not found' });
    return json(200, { voided: true });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('payment void failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not void the payment' });
  }
}
