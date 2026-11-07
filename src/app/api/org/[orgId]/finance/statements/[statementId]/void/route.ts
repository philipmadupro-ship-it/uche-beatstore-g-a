/**
 * POST …/finance/statements/[statementId]/void `{ reason? }` (LABEL-63). `finance.approve`.
 *
 * Draft, approved or issued → void, with a reason. Refused (409 `has_payments`) while a payment is
 * recorded against it: void the payments first. A void statement frees its earnings for a new
 * draft and disappears from the artist's view.
 */
import { NextRequest } from 'next/server';
import { OrgStatementVoidBodySchema } from '@/lib/contracts';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { json, statementFor } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.statement.void');

type Params = { params: Promise<{ orgId: string; statementId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, statementId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  try {
    const access0 = await requireOrgModule(orgId, 'finance', 'finance.approve');
    if (!access0.ok) return access0.res;
    const found = await statementFor(access0, statementId, true);
    if (!found.ok) return found.res;
    const body = await readBody(req, OrgStatementVoidBodySchema);
    if (!body.ok) return body.res;
    const { access, row } = found.ctx;
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'statementVoid', {
        p_org: access.orgId,
        p_actor: access.userId,
        p_statement: row.id,
        p_reason: body.data.reason ?? null,
        p_payload: { periodId: row.period_id, reasoned: !!body.data.reason },
      }),
      'statement void',
    );
    if (out.error === 'period_closed') return json(409, { error: 'This statement belongs to a closed period. Ask an owner to reopen the period first.', code: 'period_closed' });
    if (out.error === 'has_payments') return json(409, { error: 'Void the payments recorded against this statement first.', code: 'has_payments' });
    if (out.error === 'already_void') return json(409, { error: 'This statement is already void.', code: 'already_void' });
    if (out.error) return json(404, { error: 'Statement not found' });
    return json(200, { voided: true });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('statement void failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not void the statement' });
  }
}
