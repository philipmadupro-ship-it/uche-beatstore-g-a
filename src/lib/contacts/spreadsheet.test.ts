import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('server-only', () => ({}));

import { parseXlsx, cellToText } from './spreadsheet';

async function workbook(rows: ExcelJS.CellValue[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Contacts');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseXlsx', () => {
  it('returns the header row and data rows as strings', async () => {
    const buf = await workbook([
      ['Name', 'Email', 'Deals'],
      ['Ada', 'ada@example.test', 3],
      ['Bo', 'bo@example.test', null],
    ]);
    expect(await parseXlsx(buf)).toEqual({
      headers: ['Name', 'Email', 'Deals'],
      rows: [
        ['Ada', 'ada@example.test', '3'],
        ['Bo', 'bo@example.test', ''],
      ],
    });
  });

  it('skips blank rows between entries', async () => {
    const buf = await workbook([['Name'], ['Ada'], [], ['Bo']]);
    expect((await parseXlsx(buf)).rows).toEqual([['Ada'], ['Bo']]);
  });

  it('rejects a file that is not a workbook with a readable message', async () => {
    await expect(parseXlsx(Buffer.from('name,email\nAda,ada@example.test'))).rejects.toThrow(/\.xlsx or \.csv/);
  });
});

describe('cellToText', () => {
  it('flattens rich text, hyperlinks, formulas and dates', () => {
    expect(cellToText({ richText: [{ text: 'Big ' }, { text: 'Label' }] })).toBe('Big Label');
    expect(cellToText({ text: 'ada@example.test', hyperlink: 'mailto:ada@example.test' })).toBe('ada@example.test');
    expect(cellToText({ formula: 'A1&B1', result: 'joined' })).toBe('joined');
    expect(cellToText(new Date('2026-09-17T00:00:00Z'))).toBe('2026-09-17');
    expect(cellToText(null)).toBe('');
  });
});
