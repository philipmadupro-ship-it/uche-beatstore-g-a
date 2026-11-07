/**
 * /api/org/[orgId]/finance/advances (LABEL-64).
 *
 *   GET   the advances ledger the caller may read: `finance.read` (never a roster artist), inside
 *         their artist scope. Each row carries what has been recouped and what remains, and whether
 *         its terms can still change. Also the payees an advance can be made to.
 *   POST  record an advance `{ payee_id, kind: 'recoupable' | 'non_recoupable', amount_minor,
 *         paid_on?, note? }`. `finance.write`. The currency is the payee's. A member limited to some
 *         artists can only advance to a payee of theirs. Audited (advance.created).
 *
 * An advance is money the label paid out ELSEWHERE; this records it, it never sends it.
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { OrgAdvanceCreateBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { advanceState, advanceView, ledgerTotals } from '@/lib/labelos/finance/advances';
import { assertAdvancesSchema, listAdvances, payeeChoices } from '@/lib/labelos/finance-dashboard-store';
import { json } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.advances');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  try {
    const [rows, payees] = await Promise.all([listAdvances(access.admin, access.orgId, access.artistScope), payeeChoices(access.admin, access.orgId, access.artistScope)]);
    const states = rows.map((r) => ({ currency: r.currency.trim(), kind: r.kind, state: advanceState(r, r.facts) }));
    return json(200, {
      schemaReady: true,
      canWrite: access.capabilities.has('finance.write'),
      advances: rows.map((r) => advanceView(r, r.facts)),
      totals: ledgerTotals(states).map((t) => ({
        currency: t.currency,
        recoupableMinor: t.recoupable.toString(),
        nonRecoupableMinor: t.nonRecoupable.toString(),
        recoupedMinor: t.recouped.toString(),
        unrecoupedMinor: t.unrecouped.toString(),
      })),
      payees: payees.map((p) => ({ id: p.id, name: p.name, currency: p.currency, active: p.status === 'active' })),
    });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(200, { schemaReady: false, canWrite: false, advances: [], totals: [], payees: [] });
    log.error('advance list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the advances' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  const body = await readBody(req, OrgAdvanceCreateBodySchema);
  if (!body.ok) return body.res;
  try {
    await assertAdvancesSchema(access.admin);
    const payees = await payeeChoices(access.admin, access.orgId, access.artistScope);
    const payee = payees.find((p) => p.id === body.data.payee_id);
    // 404 for a payee outside the org AND for one outside a scoped member's artists: no oracle either way.
    if (!payee || !scopeAllowsContact(access.artistScope, payee.artistContactId)) return json(404, { error: 'Payee not found' });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'advanceCreate', {
        p_org: access.orgId,
        p_actor: access.userId,
        p_payee: payee.id,
        p_kind: body.data.kind,
        p_amount: body.data.amount_minor,
        p_paid_on: body.data.paid_on ?? null,
        p_note: body.data.note ?? null,
        p_payload: { hasDate: !!body.data.paid_on, hasNote: !!body.data.note },
      }),
      'advance create',
    );
    if (out.error === 'payee_inactive') return json(409, { error: 'That payee is inactive.', code: 'payee_inactive' });
    if (out.error === 'refused') return json(400, { error: 'The advance was refused (check the amount and the payee’s currency).' });
    if (out.error) return json(404, { error: 'Payee not found' });
    return json(201, { id: String(out.data.id) });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY + ' Advances also need migration 182.' });
    log.error('advance create failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not record the advance' });
  }
}
