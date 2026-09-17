import 'server-only';

/**
 * First worksheet of an .xlsx file as rows of strings, header row first.
 *
 * Replaces the `xlsx` (SheetJS) package, whose npm release carries
 * prototype-pollution and ReDoS advisories with no fix published to npm.
 * exceljs reads Office Open XML only, so legacy binary .xls is not
 * supported; the importer asks for .xlsx or .csv instead.
 */

import type ExcelJS from 'exceljs';

/** Upper bounds so a hostile workbook can't turn one request into a long parse. */
export const MAX_SPREADSHEET_ROWS = 20_000;
export const MAX_SPREADSHEET_COLUMNS = 100;

type CellValue = ExcelJS.CellValue;

/** Render a cell the way the producer sees it in Excel, as plain text. */
export function cellToText(value: CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    // Hyperlink cells: the visible text, falling back to the address.
    if ('hyperlink' in value) {
      const text = (value as { text?: unknown }).text;
      return typeof text === 'string' ? text : cellToText(text as CellValue) || String(value.hyperlink ?? '');
    }
    if ('formula' in value || 'sharedFormula' in value) {
      return cellToText((value as { result?: CellValue }).result ?? null);
    }
    if ('error' in value) return '';
  }
  return String(value);
}

export async function parseXlsx(buf: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
  // Loaded on first use: only the contact import needs it.
  const { default: Excel } = await import('exceljs');
  const workbook = new Excel.Workbook();
  try {
    await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error('Could not read that spreadsheet. Save it as .xlsx or .csv and try again.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  if (sheet.rowCount > MAX_SPREADSHEET_ROWS + 1) {
    throw new Error(`That sheet has more than ${MAX_SPREADSHEET_ROWS.toLocaleString('en-US')} rows. Split it and import in parts.`);
  }

  const width = Math.min(sheet.columnCount, MAX_SPREADSHEET_COLUMNS);
  const all: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let col = 1; col <= width; col++) cells.push(cellToText(row.getCell(col).value).trim());
    all.push(cells);
  });

  // Blank rows between entries are common in hand-kept lists; drop them
  // rather than reporting each as an invalid contact.
  const nonEmpty = all.filter((r) => r.some((c) => c !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { headers, rows };
}
