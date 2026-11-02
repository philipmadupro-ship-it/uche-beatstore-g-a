/**
 * POST …/finance/statements/[statementId]/payments `{ amount_minor, paid_on, reference? }` (LABEL-63).
 * `finance.write`.
 *
 * RECORDS a payment somebody made elsewhere: the app never moves money and holds no account.
 * Against an ISSUED statement only; partial payments are allowed; the live payments never add up to
 * more than the statement's net (409 `exceeds_net`, naming what is left; the database re-checks it
 * under the statement's row lock). The reference is free text ("wire 2026-10-05"), never an
 * account number — one that looks like one is refused. The date is not in the future.
 */
import { NextRequest } from 'next/server';
import { OrgPaymentCreateBodySchema } from '@/lib/contracts';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { looksLikeBankNumber } from '@/lib/labelos/payee';
import { json, statementFor } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.payment');

type Params = { params: Promise<{ orgId: string; statementId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, statementId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  try {
    const access0 = await requireOrgModule(orgId, 'finance', 'finance.write');
    if (!access0.ok) return access0.res;
    const found = await statementFor(access0, statementId, true);
    if (!found.ok) return found.res;
    const body = await readBody(req, OrgPaymentCreateBodySchema);
    if (!body.ok) return body.res;
    const { access, row } = found.ctx;
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    if (body.data.paid_on > tomorrow) return json(400, { error: `A payment cannot be dated in the future (today is ${today}).` });
    if (body.data.reference && looksLikeBankNumber(body.data.reference)) {
      return json(400, { error: 'That looks like an account number. Record a reference (for example “wire 2026-10-05”), never the account itself.' });
    }
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'paymentRecord', {
        p_org: access.orgId,
        p_actor: access.userId,
        p_statement: row.id,
        p_amount: body.data.amount_minor,
        p_paid_on: body.data.paid_on,
        p_reference: body.data.reference ?? null,
        p_payload: { referenced: !!body.data.reference },
      }),
      'payment record',
    );
    if (out.error === 'exceeds_net') {
      return json(409, { error: 'That is more than is left to pay on this statement.', code: 'exceeds_net', ...(typeof out.data.remaining === 'string' ? { remaining_minor: out.data.remaining } : {}) });
    }
    if (out.error === 'not_issued') return json(409, { error: 'A payment is recorded against an issued statement.', code: 'not_issued' });
    if (out.error === 'refused') return json(400, { error: 'The database refused that payment.' });
    if (out.error) return json(404, { error: 'Statement not found' });
    return json(201, { id: out.data.id });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('payment record failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not record the payment' });
  }
}
