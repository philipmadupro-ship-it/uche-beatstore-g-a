/**
 * GET …/finance/statements/payout?currency=XXX (LABEL-63): the payout CSV — one row per APPROVED or
 * ISSUED statement that still has money outstanding (what finance pays out, outside this system).
 * `finance.approve`, inside the caller's artist scope. Payees paid in different currencies are
 * different rows, never summed; `?currency=` narrows to one.
 *
 * The file holds what was approved and what has been paid — and the payee's free-text payment note
 * ("wire ref on file"), which the database guarantees is never an account number. The app moves no
 * money. Audited as `statement.exported` BEFORE the first byte (one event, `format: payout`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { minorFromDb } from '@/lib/labelos/finance/money';
import { payoutCsv, type PayoutRow } from '@/lib/labelos/finance/statement-document';
import { isCurrency } from '@/lib/labelos/finance/money';
import { json } from '@/lib/labelos/statement-route';
import { listPeriods, listStatementRows, payeeNames, readPayments, resolveReader, StatementsNotReadyError } from '@/lib/labelos/statement-store';
import { positionOf } from '@/lib/labelos/finance/statement-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.payout');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.approve');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  const currency = new URL(req.url).searchParams.get('currency');
  if (currency !== null && !isCurrency(currency)) return json(400, { error: 'Unknown currency' });
  try {
    const reader = await resolveReader(access.admin, access.orgId, access.userId, access);
    if (!reader || reader.kind !== 'staff') return json(403, { error: 'Not allowed' });
    const statements = (await listStatementRows(access.admin, access.orgId, reader)).filter((s) => (s.status === 'approved' || s.status === 'issued') && (!currency || s.currency.trim() === currency));
    const [payments, periods, names, payeeRefs] = await Promise.all([
      readPayments(access.admin, access.orgId, statements.map((s) => s.id)),
      listPeriods(access.admin, access.orgId),
      payeeNames(access.admin, access.orgId, [...new Set(statements.map((s) => s.payee_id))]),
      access.capabilities.has('finance.write') ? payeeReferences(access.admin, access.orgId, [...new Set(statements.map((s) => s.payee_id))]) : Promise.resolve(new Map<string, string>()),
    ]);
    const periodLabel = new Map(periods.map((p) => [p.id, p.label]));
    const rows: PayoutRow[] = [];
    for (const s of statements) {
      const own = payments.filter((p) => p.statement_id === s.id);
      const pos = positionOf(s.net_minor, own);
      // Approved: the whole net is still to pay. Issued: whatever is left. Nothing owed → not on the list.
      const outstanding = s.status === 'approved' ? (minorFromDb(s.net_minor) > BigInt(0) ? minorFromDb(s.net_minor) : BigInt(0)) : pos.outstandingMinor;
      if (outstanding <= BigInt(0)) continue;
      rows.push({
        statementId: s.id,
        payeeName: names.get(s.payee_id) ?? 'Payee',
        periodLabel: periodLabel.get(s.period_id) ?? '',
        currency: s.currency.trim(),
        netMinor: minorFromDb(s.net_minor),
        paidMinor: pos.paidMinor,
        outstandingMinor: outstanding,
        status: s.status,
        paymentState: s.status === 'approved' ? 'unpaid' : pos.state,
        paymentReference: payeeRefs.get(s.payee_id) ?? null,
      });
    }
    rows.sort((a, b) => a.currency.localeCompare(b.currency) || a.payeeName.localeCompare(b.payeeName) || a.statementId.localeCompare(b.statementId));

    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'statement.exported', { type: 'org', id: access.orgId }, { format: 'payout', statements: rows.length });

    return new NextResponse(payoutCsv(rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payout-${new Date().toISOString().slice(0, 10)}${currency ? `-${currency}` : ''}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: 'Statements are not set up on this database yet.' });
    log.error('payout export failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not export the payout list' });
  }
}

async function payeeReferences(admin: import('@/lib/auth/ownership').AdminClient, orgId: string, payeeIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (payeeIds.length === 0) return out;
  const { inChunks } = await import('@/lib/labelos/paged-read');
  const rows = await inChunks<{ id: string; payment_reference: string | null }>(
    payeeIds,
    (part, from, to) => admin.from('payees').select('id, payment_reference').eq('org_id', orgId).in('id', part).order('id', { ascending: true }).range(from, to),
    'payee references',
  );
  for (const r of rows) if (r.payment_reference) out.set(r.id, r.payment_reference);
  return out;
}
