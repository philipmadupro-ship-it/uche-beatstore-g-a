/**
 * The statement as a PDF (LABEL-63). Server-side, pdfkit (a dependency since LABEL-58, listed in
 * serverExternalPackages). Built-in fonts are WinAnsi, so text goes through `toWinAnsi` first
 * (LABEL-58's helper). Streams from the server; there is no URL for it anywhere.
 */
import PDFDocument from 'pdfkit';
import { toWinAnsi } from '../contracts/document';
import { PAYMENT_STATE_LABEL } from './statement-calc';
import { dec, formatShareUnits, type StatementDocument } from './statement-document';
import { STATEMENT_STATUS_LABEL } from './statement-view';

const text = (s: string): string => toWinAnsi(s);
const withCurrency = (minor: bigint, currency: string): string => {
  const plain = dec(minor, currency);
  const [whole, frac] = plain.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${plain.startsWith('-') ? '-' : ''}${grouped}${frac ? `.${frac}` : ''} ${currency}`;
};

export function renderStatementPdf(d: StatementDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 64, bottom: 64, left: 64, right: 64 },
      info: { Title: text(`Statement — ${d.payeeName} — ${d.periodLabel}`), Producer: 'Label OS' },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font('Helvetica-Bold').fontSize(20).text('Statement');
    doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor('#555555');
    doc.text(text(`${d.orgName} · ${STATEMENT_STATUS_LABEL[d.status] ?? d.status}${d.issuedOn ? ` · issued ${d.issuedOn}` : ''}`));
    doc.fillColor('#000000');

    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text(text(d.payeeName));
    doc.font('Helvetica').fontSize(10);
    doc.text(text(`Period: ${d.periodLabel}${d.periodStartsOn && d.periodEndsOn ? ` (${d.periodStartsOn} to ${d.periodEndsOn})` : ''}`));
    doc.text(`Currency: ${d.currency}`);

    const row = (label: string, share: string, amount: string, opts: { bold?: boolean } = {}) => {
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(text(label), left, y, { width: width * 0.55, lineBreak: true });
      const after = doc.y;
      doc.text(share, left + width * 0.55, y, { width: width * 0.15, align: 'right', lineBreak: false });
      doc.text(text(amount), left + width * 0.7, y, { width: width * 0.3, align: 'right', lineBreak: false });
      doc.y = after;
      doc.x = left;
    };

    doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text('Earnings');
    doc.moveDown(0.3);
    row('Song', 'Share', 'Amount', { bold: true });
    doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor('#bbbbbb').stroke();
    doc.moveDown(0.4);
    if (d.songs.length === 0) doc.font('Helvetica-Oblique').fontSize(9).text('Nothing earned in this period.');
    for (const s of d.songs) row(s.title, s.shareUnits === null ? '' : `${formatShareUnits(s.shareUnits)}%`, withCurrency(s.earnedMinor, d.currency));

    doc.moveDown(0.6);
    row('Advances recouped', '', withCurrency(-d.recoupedMinor, d.currency));
    doc.moveDown(0.4);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor('#bbbbbb').stroke();
    doc.moveDown(0.4);
    row('Net', '', withCurrency(d.netMinor, d.currency), { bold: true });

    if (d.status === 'issued') {
      doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text('Payments');
      doc.moveDown(0.3);
      const live = d.payments.filter((p) => !p.voided);
      if (live.length === 0) doc.font('Helvetica-Oblique').fontSize(9).text('No payment recorded yet.');
      for (const p of live) row(`Paid ${p.paidOn}`, '', withCurrency(p.amountMinor, d.currency));
      doc.moveDown(0.4);
      row('Paid', '', withCurrency(d.paidMinor, d.currency), { bold: true });
      row(`Outstanding — ${PAYMENT_STATE_LABEL[d.paymentState]}`, '', withCurrency(d.outstandingMinor, d.currency), { bold: true });
      doc.moveDown(0.6).font('Helvetica-Oblique').fontSize(8).fillColor('#555555');
      doc.text('Payments are records of payments made outside this system. Label OS does not move money.', left, doc.y, { width });
      doc.fillColor('#000000');
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(8).fillColor('#777777');
      doc.page.margins.bottom = 0;
      doc.text(text(`Statement ${d.statementId.slice(0, 8)} · ${d.generatedOn} · page ${i + 1} of ${range.count}`), left, doc.page.height - 40, { width, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
