/**
 * GET /api/org/[orgId]/finance/statements/[statementId] (LABEL-63): one statement with its songs,
 * the advances recouped, its payments and — for staff — the actions open to the caller.
 *
 * Who: staff in the statement's artist scope, or the payee's own artist for an ISSUED statement
 * (`mayReadStatement`). Anything else is 404. The payment reference is sent only to `finance.write`.
 * The approver's and generator's names are never sent; an artist sees no draft state.
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { minorFromDb } from '@/lib/labelos/finance/money';
import { statementActions } from '@/lib/labelos/finance/statement-calc';
import { positionOf, statementDetailView } from '@/lib/labelos/finance/statement-view';
import { json, statementFor } from '@/lib/labelos/statement-route';
import { isOrgOwner, payeeNames, periodsById, readLines, readPayments, StatementsNotReadyError } from '@/lib/labelos/statement-store';
import { planApproval } from '@/lib/labelos/finance/statement-calc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.statement');

type Params = { params: Promise<{ orgId: string; statementId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, statementId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  try {
    const access0 = await requireOrgModule(orgId, 'finance');
    if (!access0.ok) return access0.res;
    const found = await statementFor(access0, statementId);
    if (!found.ok) return found.res;
    const { access, reader, row } = found.ctx;
    const own = reader.kind === 'own';
    const [lines, payments, periods, names] = await Promise.all([
      readLines(access.admin, access.orgId, row.id),
      readPayments(access.admin, access.orgId, [row.id]),
      periodsById(access.admin, access.orgId, [row.period_id]),
      own ? Promise.resolve(new Map<string, string>()) : payeeNames(access.admin, access.orgId, [row.payee_id]),
    ]);
    let actions: Record<string, boolean> | undefined;
    if (!own) {
      const pos = positionOf(row.net_minor, payments);
      const base = statementActions(row.status, access.capabilities, pos.outstandingMinor, pos.paidMinor);
      // The generator cannot approve their own draft unless an owner: show the button only to someone who can use it.
      let approve = base.approve;
      if (approve) approve = planApproval({ generatedBy: row.created_by, actor: access.userId, actorIsOwner: await isOrgOwner(access.admin, access.orgId, access.userId) }).ok;
      actions = { ...base, approve };
    }
    const reference = !own && access.capabilities.has('finance.write');
    return json(200, {
      schemaReady: true,
      own,
      statement: statementDetailView(row, lines, {
        own,
        payeeName: own ? null : (names.get(row.payee_id) ?? null),
        period: periods.get(row.period_id) ?? null,
        payments: own ? payments.filter((p) => p.voided_at === null) : payments,
        reference,
        actions,
      }),
      lineTotal: lines.reduce((s, l) => s + minorFromDb(l.amount_minor), BigInt(0)).toString(),
    });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(200, { schemaReady: false });
    log.error('statement read failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the statement' });
  }
}
