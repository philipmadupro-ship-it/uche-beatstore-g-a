/**
 * The contract as a PDF (LABEL-58). Server-side, pdfkit (already a dependency;
 * nothing else renders here). The input is the SAME `Rendered` the live
 * preview shows plus the contract's header facts, so the file says exactly
 * what the screen said. Only the facts below ever reach it: a party's name,
 * never a tax id or payment instructions.
 *
 * pdfkit's built-in fonts are WinAnsi: a character outside it would be drawn
 * as garbage, so `toWinAnsi` replaces those with "?" first (a name in another
 * script prints as question marks; the on-screen text and the stored contract
 * keep the real characters).
 */
import PDFDocument from 'pdfkit';
import type { RenderedClause } from './render';

export type ContractDocumentInput = {
  title: string;
  typeLabel: string;
  statusLabel: string;
  version: number;
  parties: { roleLabel: string; name: string }[];
  clauses: RenderedClause[];
  /** Merge values still empty; a draft prints them in brackets and says so. */
  missing: string[];
  generatedOn: string;
};

// The 27 printable characters cp1252 has above 0x7F that are not Latin-1.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n' || ch === '\t' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(ch)) out += ch;
    else out += code < 0x20 || code === 0x7f ? ' ' : '?';
  }
  return out;
}

/**
 * `contract-<id first 12>-v<n>-<status>.pdf`: one name per contract version and
 * status, so a repeat finds the file it made, and the copy frozen at "sent" is
 * never mistaken for the draft's.
 */
export function contractDocumentFileName(contractId: string, version: number, status: string): string {
  return `contract-${contractId.replace(/-/g, '').slice(0, 12)}-v${version}-${status}.pdf`;
}

export function renderContractDocumentPdf(input: ContractDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 64, bottom: 64, left: 64, right: 64 },
      info: { Title: toWinAnsi(input.title), Producer: 'Label OS' },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text(toWinAnsi(input.title));
    doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor('#555555');
    doc.text(toWinAnsi(`${input.typeLabel} · ${input.statusLabel} · version ${input.version}`));
    doc.fillColor('#000000');
    if (input.parties.length > 0) {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).text('Parties');
      doc.font('Helvetica').fontSize(10);
      for (const p of input.parties) doc.text(toWinAnsi(`${p.roleLabel}: ${p.name}`));
    }
    if (input.missing.length > 0) {
      doc.moveDown(0.6).font('Helvetica-Oblique').fontSize(9).fillColor('#8d3a2f');
      doc.text(`Draft: ${input.missing.length} value${input.missing.length === 1 ? ' is' : 's are'} still empty and shown in [brackets].`);
      doc.fillColor('#000000');
    }
    input.clauses.forEach((c, i) => {
      doc.moveDown(1).font('Helvetica-Bold').fontSize(11).text(toWinAnsi(`${i + 1}. ${c.heading}`));
      doc.moveDown(0.25).font('Helvetica').fontSize(10.5);
      for (const para of c.body.split(/\n{2,}/)) {
        doc.text(toWinAnsi(para.trim()), { lineGap: 2, paragraphGap: 4 });
      }
    });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(8).fillColor('#777777');
      // The footer sits in the bottom margin: without this pdfkit adds a page for text below maxY().
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 40;
      doc.text(toWinAnsi(`${input.title} · version ${input.version} · ${input.generatedOn} · page ${i + 1} of ${range.count}`), doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
        lineBreak: false,
      });
    }
    doc.end();
  });
}
