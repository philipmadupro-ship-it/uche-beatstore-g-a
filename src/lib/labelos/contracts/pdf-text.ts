/**
 * Reads the text back out of a PDF made by `renderContractDocumentPdf`
 * (LABEL-58). Pure, no dependency: pdfkit writes each text run as a `TJ` array
 * of WinAnsi hex strings in a Flate-compressed content stream. Used by the
 * tests to prove the file holds the filled values; not a general PDF reader.
 */
import { inflateSync } from 'node:zlib';

const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

const decodeHex = (hex: string): string => {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    out += CP1252[code] ?? String.fromCharCode(code);
  }
  return out;
};

/** The text of every page, one entry per text run, in drawing order. */
export function pdfTextRuns(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const runs: string[] = [];
  for (const m of text.matchAll(/stream\r?\n([\s\S]*?)\nendstream/g)) {
    let content = m[1];
    try {
      content = inflateSync(Buffer.from(content, 'latin1')).toString('latin1');
    } catch {
      // not compressed (or not a content stream): read as is
    }
    for (const tj of content.matchAll(/\[((?:<[0-9a-fA-F]*>|[-\d.\s])*)\]\s*TJ/g)) {
      runs.push([...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => decodeHex(h[1])).join(''));
    }
  }
  return runs;
}

/** All the text joined, whitespace collapsed: what a test asserts against. */
export function pdfText(pdf: Buffer): string {
  return pdfTextRuns(pdf).join(' ').replace(/\s+/g, ' ').trim();
}
