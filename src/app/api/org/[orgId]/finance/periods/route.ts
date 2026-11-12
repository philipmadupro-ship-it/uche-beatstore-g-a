/**
 * /api/org/[orgId]/finance/periods (LABEL-63).
 *
 *   GET   the finance periods of the org (label, dates, open / closed). `finance.read`.
 *   POST  open a period `{ label, starts_on, ends_on }`. `finance.write`, whole-organization
 *         only (a period is the org's, not one artist's). Closing a period is LABEL-64's.
 *
 * Earnings are imported into a period and a statement is made for a payee and a period.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { OrgFinancePeriodCreateBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { periodView } from '@/lib/labelos/finance/statement-view';
import { insertPeriod, listPeriods, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.periods');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  try {
    const periods = await listPeriods(access.admin, access.orgId);
    return json(200, { schemaReady: true, canWrite: access.capabilities.has('finance.write') && access.artistScope === null, periods: periods.map(periodView) });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(200, { schemaReady: false, canWrite: false, periods: [] });
    log.error('period list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the periods' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  if (access.artistScope !== null) return json(403, { error: 'Opening a period needs finance access to the whole organization.' });
  const body = await readBody(req, OrgFinancePeriodCreateBodySchema);
  if (!body.ok) return body.res;
  try {
    const out = await insertPeriod(access.admin, access.orgId, access.userId, body.data);
    if ('duplicate' in out) return json(409, { error: 'A period with those dates already exists.' });
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'period.created', { type: 'finance_period', id: out.period.id }, {});
    return json(201, { period: periodView(out.period) });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('period create failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not open the period' });
  }
}
