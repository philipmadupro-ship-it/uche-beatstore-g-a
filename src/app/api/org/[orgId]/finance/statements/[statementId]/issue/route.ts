/**
 * POST …/finance/statements/[statementId]/issue (LABEL-63). `finance.approve`.
 *
 * Approved → issued. From then the statement is frozen (migration 179's triggers) and the payee's
 * own artist can read it (179's policies; `mayReadStatement` here). Payments are recorded against
 * an issued statement only.
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { json, statementFor } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.statement.issue');

type Params = { params: Promise<{ orgId: string; statementId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, statementId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  try {
    const access0 = await requireOrgModule(orgId, 'finance', 'finance.approve');
    if (!access0.ok) return access0.res;
    const found = await statementFor(access0, statementId, true);
    if (!found.ok) return found.res;
    const { access, row } = found.ctx;
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'statementIssue', { p_org: access.orgId, p_actor: access.userId, p_statement: row.id, p_payload: { periodId: row.period_id } }),
      'statement issue',
    );
    if (out.error === 'not_approved') return json(409, { error: 'Only an approved statement is issued.', code: 'not_approved' });
    if (out.error) return json(404, { error: 'Statement not found' });
    return json(200, { issued: true });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('statement issue failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not issue the statement' });
  }
}
