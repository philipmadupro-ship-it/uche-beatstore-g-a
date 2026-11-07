import { describe, expect, it } from 'vitest';
import { pdfText } from '../contracts/pdf-text';
import { formatShareUnits, payoutCsv, statementCsv, statementFileName, type StatementDocument } from './statement-document';
import { renderStatementPdf } from './statement-pdf';

const B = (n: number | string) => BigInt(n);
const doc = (over: Partial<StatementDocument> = {}): StatementDocument => ({
  statementId: '11111111-2222-4333-8444-555555555555',
  orgName: 'Label L',
  payeeName: 'Ara',
  periodLabel: 'Q3 2026',
  periodStartsOn: '2026-07-01',
  periodEndsOn: '2026-09-30',
  currency: 'USD',
  status: 'issued',
  issuedOn: '2026-10-05',
  generatedOn: '2026-11-02',
  songs: [{ title: 'Night Shift', shareUnits: 600000, earnedMinor: B(60000) }],
  recoupedMinor: B(50000),
  netMinor: B(10000),
  paidMinor: B(6000),
  outstandingMinor: B(4000),
  paymentState: 'partial',
  payments: [{ paidOn: '2026-10-09', amountMinor: B(6000), voided: false }],
  ...over,
});

describe('statement CSV', () => {
  it('golden: songs, recouped, net, payments, outstanding — plain decimals', () => {
    expect(statementCsv(doc()).split('\r\n')).toEqual([
      'Section,Item,Share %,Amount',
      'Statement,Payee,,Ara',
      'Statement,Period,,Q3 2026 (2026-07-01 to 2026-09-30)',
      'Statement,Currency,,USD',
      'Statement,Status,,Issued',
      'Statement,Issued,,2026-10-05',
      'Earnings,Night Shift,60,600.00',
      'Advances,Recouped,,-500.00',
      'Total,Net,,100.00',
      'Payment,2026-10-09,,60.00',
      'Total,Paid,,60.00',
      'Total,Outstanding,,40.00',
      '',
    ]);
  });

  it('neutralises a formula in a song title or a payee name', () => {
    const csv = statementCsv(doc({ payeeName: '=HYPERLINK("x")', songs: [{ title: '+cmd', shareUnits: null, earnedMinor: B(1) }] }));
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'+cmd`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it('has no account number column anywhere', () => {
    expect(statementCsv(doc())).not.toMatch(/iban|account|routing|sort code/i);
  });
});

describe('payout CSV', () => {
  it('one row per statement, never summing currencies', () => {
    const csv = payoutCsv([
      { statementId: 's1', payeeName: 'Ara', periodLabel: 'Q3', currency: 'USD', netMinor: B(10000), paidMinor: B(0), outstandingMinor: B(10000), status: 'approved', paymentState: 'unpaid', paymentReference: 'wire ref on file' },
      { statementId: 's2', payeeName: 'Euro Ed', periodLabel: 'Q3', currency: 'EUR', netMinor: B(500), paidMinor: B(100), outstandingMinor: B(400), status: 'issued', paymentState: 'partial', paymentReference: null },
    ]).split('\r\n');
    expect(csv[0]).toBe('Statement,Payee,Period,Currency,Net,Paid,Outstanding,Status,Payment state,Payment reference');
    expect(csv[1]).toBe('s1,Ara,Q3,USD,100.00,0.00,100.00,Approved,Unpaid,wire ref on file');
    expect(csv[2]).toBe('s2,Euro Ed,Q3,EUR,5.00,1.00,4.00,Issued,Partly paid,');
  });
});

describe('helpers', () => {
  it('formats a share digit by digit', () => {
    expect(formatShareUnits(600000)).toBe('60');
    expect(formatShareUnits(333333)).toBe('33.3333');
    expect(formatShareUnits(null)).toBe('');
  });
  it('names the file by statement and status', () => {
    expect(statementFileName('11111111-2222-4333-8444-555555555555', 'issued', 'pdf')).toBe('statement-111111112222-issued.pdf');
  });
});

describe('statement PDF', () => {
  it('holds the payee, period, songs, recoupment, net and what is outstanding', async () => {
    const pdf = await renderStatementPdf(doc());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    for (const needle of ['Ara', 'Q3 2026', 'Night Shift', '60%', '600.00 USD', '-500.00 USD', '100.00 USD', '40.00 USD', 'does not move money']) expect(text).toContain(needle);
  });

  it('a draft shows no payments section', async () => {
    const text = pdfText(await renderStatementPdf(doc({ status: 'draft', issuedOn: null })));
    expect(text).not.toContain('Payments');
  });
});
