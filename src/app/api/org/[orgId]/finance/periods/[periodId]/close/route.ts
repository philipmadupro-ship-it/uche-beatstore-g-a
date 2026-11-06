/**
 * POST …/finance/periods/[periodId]/close (LABEL-64). `finance.approve`, whole organization only.
 *
 * Closes an open period. From then on it takes no new import and no new statement — decided in
 * the database under the same lock imports and statements take, so a close and an import that
 * race cannot both win. A period with a draft statement is 409 `drafts_open`. Audited
 * (period.closed). Reopening is the owner's (…/reopen).
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { assertAdvancesSchema, periodExists } from '@/lib/labelos/finance-dashboard-store';
import { json } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.period.close');

type Params = { params: Promise<{ orgId: string; periodId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, periodId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.approve');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  if (access.artistScope !== null) return json(403, { error: 'Closing a period needs finance access to the whole organization.' });
  if (!isUUID(periodId)) return json(404, { error: 'Period not found' });
  try {
    await assertAdvancesSchema(access.admin);
    if (!(await periodExists(access.admin, access.orgId, periodId))) return json(404, { error: 'Period not found' });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'periodClose', { p_org: access.orgId, p_actor: access.userId, p_period: periodId, p_payload: {} }),
      'period close',
    );
    if (out.error === 'drafts_open') return json(409, { error: 'This period still has draft statements. Approve or void them first.', code: 'drafts_open' });
    if (out.error === 'lines_waiting') return json(409, { error: 'Earnings lines in this period are still waiting for review. Resolve them first.', code: 'lines_waiting' });
    if (out.error === 'already_closed') return json(409, { error: 'This period is already closed.', code: 'already_closed' });
    if (out.error) return json(404, { error: 'Period not found' });
    return json(200, { closed: true });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY + ' Closing a period also needs migration 182.' });
    log.error('period close failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not close the period' });
  }
}
