/**
 * GET …/finance/statements/[statementId]/export?format=pdf|csv (LABEL-63).
 *
 * The statement as a PDF (pdfkit) or a CSV, streamed by the server — no URL, nothing presigned.
 * Who: whoever may read the statement (`mayReadStatement`): staff in its artist scope, or the payee's
 * own artist for an ISSUED one. A statement they cannot read is 404.
 *
 * Audited: `statement.exported` is an audit verb written BEFORE the first byte (recordEvent throws
 * for an audit verb, so an export that cannot be audited is not handed out). The event names the
 * statement and format, never an amount or a name. There is no account number in the file because
 * there is none anywhere in the finance record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { minorFromDb } from '@/lib/labelos/finance/money';
import { groupBySong } from '@/lib/labelos/finance/statement-calc';
import { statementCsv, statementFileName, type StatementDocument } from '@/lib/labelos/finance/statement-document';
import { renderStatementPdf } from '@/lib/labelos/finance/statement-pdf';
import { positionOf } from '@/lib/labelos/finance/statement-view';
import { json, resolveStatement } from '@/lib/labelos/statement-route';
import { payeeNames, periodsById, readLines, readPayments, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('api.org.finance.statement.export');

type Params = { params: Promise<{ orgId: string; statementId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, statementId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'pdf';
  try {
    const found = await resolveStatement(orgId, statementId);
    if (!found.ok) return found.res;
    const { access, reader, row } = found.ctx;
    if (row.status === 'void') return json(404, { error: 'Statement not found' });
    const own = reader.kind === 'own';
    const [lines, payments, periods, names, org] = await Promise.all([
      readLines(access.admin, access.orgId, row.id),
      readPayments(access.admin, access.orgId, [row.id]),
      periodsById(access.admin, access.orgId, [row.period_id]),
      payeeNames(access.admin, access.orgId, [row.payee_id]),
      access.admin.from('organizations').select('name').eq('id', access.orgId).maybeSingle(),
    ]);
    const livePayments = own ? payments.filter((p) => p.voided_at === null) : payments;
    const grouped = groupBySong(lines.map((l) => ({ kind: l.kind, trackId: l.track_id, description: l.description, shareUnits: l.share_units, amountMinor: minorFromDb(l.amount_minor) })));
    const position = positionOf(row.net_minor, livePayments);
    const period = periods.get(row.period_id);
    const doc: StatementDocument = {
      statementId: row.id,
      orgName: (org.data as { name?: string } | null)?.name ?? 'Organization',
      payeeName: names.get(row.payee_id) ?? 'Payee',
      periodLabel: period?.label ?? 'Period',
      periodStartsOn: period?.starts_on ?? null,
      periodEndsOn: period?.ends_on ?? null,
      currency: row.currency,
      status: own ? 'issued' : row.status,
      issuedOn: row.issued_at ? row.issued_at.slice(0, 10) : null,
      generatedOn: new Date().toISOString().slice(0, 10),
      songs: grouped.songs.map((s) => ({ title: s.title, shareUnits: s.shareUnits, earnedMinor: s.earnedMinor })),
      recoupedMinor: grouped.recoupedMinor,
      netMinor: minorFromDb(row.net_minor),
      paidMinor: position.paidMinor,
      outstandingMinor: position.outstandingMinor,
      paymentState: position.state,
      payments: livePayments.map((p) => ({ paidOn: p.paid_on, amountMinor: minorFromDb(p.amount_minor), voided: p.voided_at !== null })),
    };

    // The audit comes first: if it cannot be written, nothing is returned.
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'statement.exported', { type: 'statement', id: row.id, artistId: row.artist_contact_id }, { format, lines: lines.length, own });

    const fileName = statementFileName(row.id, doc.status, format);
    const headers = {
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (format === 'csv') {
      return new NextResponse(statementCsv(doc), { status: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
    }
    const pdf = await renderStatementPdf(doc);
    return new NextResponse(new Uint8Array(pdf), { status: 200, headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Length': String(pdf.byteLength) } });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: 'Statements are not set up on this database yet.' });
    log.error('statement export failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not export the statement' });
  }
}
