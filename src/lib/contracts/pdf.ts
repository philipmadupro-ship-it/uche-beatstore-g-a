/**
 * Server-side PDF renderer for license contracts.
 *
 * Uses pdfkit's stream API and a tiny markdown subset (headings,
 * bold, list items, paragraphs). We don't pull a full markdown engine
 * because the output is one short legal document and pdfkit needs to
 * paint each chunk with its own font / spacing anyway.
 */

// NOTE: server-only by construction (pdfkit uses Node streams + fs); we
// don't import 'server-only' so the Vitest node environment can still
// load the test that imports the webhook route.
import PDFDocument from 'pdfkit';

export async function renderContractPdf(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 64, bottom: 64, left: 64, right: 64 },
      info: { Title: 'License Agreement', Producer: 'U2C Beatstore' },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lines = markdown.split('\n');
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line) { doc.moveDown(0.5); continue; }

      // # Heading 1
      if (line.startsWith('# ')) {
        doc.moveDown(0.6).fontSize(22).font('Helvetica-Bold').text(line.slice(2));
        doc.moveDown(0.4);
        continue;
      }
      // ## Heading 2
      if (line.startsWith('## ')) {
        doc.moveDown(0.5).fontSize(14).font('Helvetica-Bold').text(line.slice(3));
        doc.moveDown(0.2);
        continue;
      }
      // Bullet
      if (line.startsWith('- ')) {
        doc.fontSize(11).font('Helvetica').text(`•  ${stripInlineBold(line.slice(2))}`, {
          indent: 12,
          paragraphGap: 2,
        });
        continue;
      }
      // Horizontal rule
      if (line === '---') {
        doc.moveDown(0.5);
        const y = doc.y;
        const x = doc.page.margins.left;
        const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.strokeColor('#9c9c9c').lineWidth(0.5).moveTo(x, y).lineTo(x + w, y).stroke();
        doc.moveDown(0.5);
        continue;
      }
      // Inline-bold paragraph
      writeParagraph(doc, line);
    }

    doc.end();
  });
}

/**
 * pdfkit doesn't have native inline styles, but it does have a
 * `continued: true` trick: write the surrounding plain text, then
 * switch font, write the bold span, switch back. Good enough for
 * a small legal doc.
 */
function writeParagraph(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(11).font('Helvetica');
  const parts = text.split(/\*\*(.+?)\*\*/g);
  parts.forEach((part, i) => {
    if (!part) return;
    const isBold = i % 2 === 1;
    const isLast = i === parts.length - 1;
    if (isBold) doc.font('Helvetica-Bold');
    else doc.font('Helvetica');
    doc.text(part, { continued: !isLast });
  });
  doc.moveDown(0.3);
}

function stripInlineBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1');
}
