/**
 * POST …/finance/statements/[statementId]/approve (LABEL-63). `finance.approve`.
 *
 * Approval is APPEND-ONLY: who and when are written once and the database refuses any rewrite.
 * THE RULE: the person who generated the draft may not approve it — unless they are an OWNER of
 * the organization (`planApproval`; the function re-checks it under the row lock). A draft whose
 * sources moved since it was generated (an import voided, lines re-run) is 409 `stale`: generate it
 * again. 403 for the rule, so the page can say why.
 */
import { NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { planApproval } from '@/lib/labelos/finance/statement-calc';
import { json, resolveStatement } from '@/lib/labelos/statement-route';
import { isOrgOwner, rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.statement.approve');

type Params = { params: Promise<{ orgId: string; statementId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, statementId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  try {
    const found = await resolveStatement(orgId, statementId, 'finance.approve');
    if (!found.ok) return found.res;
    const { access, row } = found.ctx;
    if (row.status !== 'draft') return json(409, { error: 'Only a draft is approved.', code: 'not_draft' });
    const plan = planApproval({ generatedBy: row.created_by, actor: access.userId, actorIsOwner: await isOrgOwner(access.admin, access.orgId, access.userId) });
    if (!plan.ok) return json(403, { error: 'Someone other than the person who generated this statement has to approve it (an owner may approve their own).', code: plan.code });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'statementApprove', { p_org: access.orgId, p_actor: access.userId, p_statement: row.id, p_payload: { periodId: row.period_id } }),
      'statement approve',
    );
    if (out.error === 'self_approval') return json(403, { error: 'Someone other than the person who generated this statement has to approve it.', code: 'self_approval' });
    if (out.error === 'stale') return json(409, { error: 'The earnings behind this draft changed. Generate it again, then approve.', code: 'stale' });
    if (out.error === 'not_draft') return json(409, { error: 'Only a draft is approved.', code: 'not_draft' });
    if (out.error) return json(404, { error: 'Statement not found' });
    return json(200, { approved: true });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('statement approve failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not approve the statement' });
  }
}
