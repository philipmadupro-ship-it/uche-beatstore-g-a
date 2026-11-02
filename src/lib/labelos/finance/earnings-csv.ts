/**
 * CSV reading for earnings imports (LABEL-62). Pure.
 *
 * A distributor file is UNTRUSTED. Everything is capped before it is parsed
 * into anything (bytes, rows, columns, cell length), the reader is a plain
 * state machine (no regex over the whole file, no eval-like feature), and a
 * cell is only ever text: a value that starts with `= + - @` stays text and is
 * guarded by `csvCell` (legal-pack.ts) on every re-export.
 *
 * Handles: UTF-8 BOM, CRLF/LF/CR, quoted cells with doubled quotes and embedded
 * newlines, and the three delimiters distributors use (`,` `;` tab), detected
 * on the header line outside quotes.
 */

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request body
export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 60;
export const MAX_CELL_CHARS = 1_000;

export type CsvFailure = 'empty' | 'too_large' | 'too_many_rows' | 'too_many_columns' | 'cell_too_long' | 'unterminated_quote' | 'ragged_row' | 'binary';

export type CsvResult =
  | { ok: true; header: string[]; rows: string[][]; delimiter: ',' | ';' | '\t' }
  | { ok: false; code: CsvFailure; line?: number };

const DELIMITERS = [',', ';', '\t'] as const;

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && (c === ',' || c === ';' || c === '\t')) counts[c]++;
  }
  return DELIMITERS.reduce((best, d) => (counts[d] > counts[best] ? d : best), ',' as ',' | ';' | '\t');
}

export function parseCsv(input: string, byteLength?: number): CsvResult {
  if ((byteLength ?? Buffer.byteLength(input, 'utf8')) > MAX_FILE_BYTES) return { ok: false, code: 'too_large' };
  // A NUL byte means this is not a text export at all.
  if (input.includes('\u0000')) return { ok: false, code: 'binary' };
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.trim() === '') return { ok: false, code: 'empty' };
  const delimiter = detectDelimiter(text);

  const records: string[][] = [];
  const recordLines: number[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawCell = false;
  let line = 1;
  let recordLine = 1;

  const endCell = (): boolean => {
    if (cell.length > MAX_CELL_CHARS) return false;
    row.push(cell);
    cell = '';
    sawCell = true;
    return row.length <= MAX_COLUMNS;
  };
  const endRow = () => {
    // A blank line is not a record.
    if (!(row.length === 0 && !sawCell) && !(row.length === 1 && row[0] === '')) {
      records.push(row);
      recordLines.push(recordLine);
    }
    row = [];
    sawCell = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        cell += c;
        if (cell.length > MAX_CELL_CHARS) return { ok: false, code: 'cell_too_long', line: recordLine };
      }
      continue;
    }
    if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delimiter) {
      if (!endCell()) return { ok: false, code: cell.length > MAX_CELL_CHARS ? 'cell_too_long' : 'too_many_columns', line: recordLine };
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (!endCell()) return { ok: false, code: 'too_many_columns', line: recordLine };
      endRow();
      line++;
      recordLine = line;
      if (records.length > MAX_ROWS + 1) return { ok: false, code: 'too_many_rows' };
    } else {
      cell += c;
      if (cell.length > MAX_CELL_CHARS) return { ok: false, code: 'cell_too_long', line: recordLine };
    }
  }
  if (quoted) return { ok: false, code: 'unterminated_quote', line: recordLine };
  if (cell !== '' || row.length > 0 || sawCell) {
    if (!endCell()) return { ok: false, code: 'too_many_columns', line: recordLine };
    endRow();
  }
  if (records.length === 0) return { ok: false, code: 'empty' };
  const header = records[0].map((h) => h.trim());
  const rows = records.slice(1);
  if (rows.length > MAX_ROWS) return { ok: false, code: 'too_many_rows' };
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length > header.length) return { ok: false, code: 'ragged_row', line: recordLines[i + 1] };
    while (rows[i].length < header.length) rows[i].push('');
  }
  return { ok: true, header, rows, delimiter };
}

export const CSV_FAILURE_MESSAGE: Readonly<Record<CsvFailure, string>> = {
  empty: 'The file is empty.',
  too_large: `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it by period and import the parts.`,
  too_many_rows: `The file has more than ${MAX_ROWS.toLocaleString('en-US')} rows. Split it by period and import the parts.`,
  too_many_columns: `The file has more than ${MAX_COLUMNS} columns.`,
  cell_too_long: `A cell is longer than ${MAX_CELL_CHARS} characters.`,
  unterminated_quote: 'A quoted cell is never closed.',
  ragged_row: 'A row has more cells than the header.',
  binary: 'This is not a text (CSV) file.',
};
