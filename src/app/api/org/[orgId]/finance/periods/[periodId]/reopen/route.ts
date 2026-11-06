/**
 * POST …/finance/periods/[periodId]/reopen (LABEL-64). OWNER ONLY — role `owner`, not a
 * capability — and checked again inside the database function. Audited (period.reopened).
 * Anyone else with finance access gets 403.
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { mayReopenRole } from '@/lib/labelos/finance/period-close';
import { assertAdvancesSchema, periodExists } from '@/lib/labelos/finance-dashboard-store';
import { json } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.period.reopen');

type Params = { params: Promise<{ orgId: string; periodId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, periodId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  if (!mayReopenRole(access.role)) return json(403, { error: 'Only an owner can reopen a closed period.' });
  if (!isUUID(periodId)) return json(404, { error: 'Period not found' });
  try {
    await assertAdvancesSchema(access.admin);
    if (!(await periodExists(access.admin, access.orgId, periodId))) return json(404, { error: 'Period not found' });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'periodReopen', { p_org: access.orgId, p_actor: access.userId, p_period: periodId, p_payload: {} }),
      'period reopen',
    );
    if (out.error === 'not_owner') return json(403, { error: 'Only an owner can reopen a closed period.' });
    if (out.error === 'not_closed') return json(409, { error: 'This period is not closed.', code: 'not_closed' });
    if (out.error) return json(404, { error: 'Period not found' });
    return json(200, { reopened: true });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY + ' Reopening a period also needs migration 182.' });
    log.error('period reopen failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not reopen the period' });
  }
}
