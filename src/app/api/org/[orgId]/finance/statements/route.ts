/**
 * /api/org/[orgId]/finance/statements (LABEL-61 read, LABEL-63 generate).
 *
 *   GET   the statements the caller may read, as summaries (no lines — a statement can hold
 *         thousands; the detail route has them).
 *         · `finance.read` (never a roster artist): every statement of the org in their artist
 *           scope, drafts included, with the payee's name, the period, and where payment stands.
 *         · a roster artist (or the owner of an artist org, for its one artist) who does NOT hold
 *           finance.read: only the ISSUED statements of their OWN payee. Never a draft, never
 *           another artist's. A party linked to their account proves nothing.
 *         · everyone else, and an org without the finance module: 404 / 403.
 *   POST  generate the statement for one payee and one period `{ payee_id, period_id }`.
 *         `finance.write`. Replaces ONLY a draft of the same payee and period; an approved or
 *         issued statement is a 409; a closed period gets no draft. The lines are copied from the
 *         allocations and recoupments LABEL-62 stored and the database proves the copy
 *         (migration 181). A member limited to some artists generates for their artists' payees.
 *
 * Money leaves as strings of minor units.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { OrgStatementGenerateBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { statementSummaryView } from '@/lib/labelos/finance/statement-view';
import { mayActOnPayee } from '@/lib/labelos/statement-access';
import {
  emptyOutcome,
  generateOutcome,
  listPeriods,
  listStatementRows,
  payeeNames,
  prepareStatement,
  readPayee,
  readPayments,
  resolveReader,
  STATEMENTS_NOT_READY,
  StatementsNotReadyError,
} from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('api.org.finance.statements');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance');
  if (!access.ok) return access.res;

  try {
    const reader = await resolveReader(access.admin, access.orgId, access.userId, access);
    // Nothing of one's own is an empty list, not an error; someone who is neither staff nor anybody's payee is refused.
    if (!reader) {
      if (access.role === 'artist') return json(200, { schemaReady: true, own: true, statements: [] });
      return json(403, { error: 'Not allowed' });
    }
    const own = reader.kind === 'own';
    const rows = await listStatementRows(access.admin, access.orgId, reader);
    const ids = rows.map((r) => r.id);
    const [periods, payments, names] = await Promise.all([
      listPeriods(access.admin, access.orgId),
      readPayments(access.admin, access.orgId, ids),
      own ? Promise.resolve(new Map<string, string>()) : payeeNames(access.admin, access.orgId, [...new Set(rows.map((r) => r.payee_id))]),
    ]);
    const periodById = new Map(periods.map((p) => [p.id, p]));
    const paymentsByStatement = new Map<string, typeof payments>();
    for (const p of payments) if (p.statement_id) paymentsByStatement.set(p.statement_id, [...(paymentsByStatement.get(p.statement_id) ?? []), p]);
    return json(200, {
      schemaReady: true,
      own,
      canGenerate: !own && access.capabilities.has('finance.write'),
      canApprove: !own && access.capabilities.has('finance.approve'),
      statements: rows.map((r) =>
        statementSummaryView(r, { own, payeeName: own ? null : (names.get(r.payee_id) ?? null), period: periodById.get(r.period_id) ?? null, payments: paymentsByStatement.get(r.id) ?? [], lineCount: null }),
      ),
    });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(200, { schemaReady: false, own: false, statements: [] });
    log.error('statement list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the statements' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  const body = await readBody(req, OrgStatementGenerateBodySchema);
  if (!body.ok) return body.res;
  try {
    const payee = await readPayee(access.admin, access.orgId, body.data.payee_id);
    // A payee outside the member's artists does not exist for them.
    if (!payee || !mayActOnPayee(access.artistScope, payee)) return json(404, { error: 'Payee not found' });
    const prepared = await prepareStatement(access.admin, access.orgId, access.userId, payee, body.data.period_id);
    const outcome = prepared.empty
      ? emptyOutcome()
      : generateOutcome(await auditRpc(access.admin as unknown as AuditRpcAdmin, 'statementGenerate', prepared.args));
    if (!outcome.ok) return json(outcome.code === 'not_found' ? 404 : 409, { error: outcome.message, code: outcome.code });
    return json(201, { id: outcome.id, lines: outcome.lines });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('statement generate failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not generate the statement' });
  }
}
