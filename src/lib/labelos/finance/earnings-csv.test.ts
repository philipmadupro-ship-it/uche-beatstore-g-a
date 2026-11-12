import { describe, expect, it } from 'vitest';
import { MAX_CELL_CHARS, MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS, parseCsv } from './earnings-csv';

describe('parseCsv', () => {
  it('reads a plain file, strips a BOM, and accepts CRLF', () => {
    const r = parseCsv('﻿a,b\r\n1,2\r\n3,4\r\n');
    expect(r).toEqual({ ok: true, header: ['a', 'b'], rows: [['1', '2'], ['3', '4']], delimiter: ',' });
  });

  it('reads quoted cells with doubled quotes, delimiters and newlines inside', () => {
    const r = parseCsv('t,n\n"He said ""hi"", twice","two\nlines"\n');
    expect(r).toMatchObject({ ok: true, rows: [['He said "hi", twice', 'two\nlines']] });
  });

  it('detects semicolon and tab delimiters outside quotes', () => {
    expect(parseCsv('a;b\n1;2')).toMatchObject({ ok: true, delimiter: ';', rows: [['1', '2']] });
    expect(parseCsv('a\tb\n1\t2')).toMatchObject({ ok: true, delimiter: '\t', rows: [['1', '2']] });
    expect(parseCsv('"a,b,c";d\n1;2')).toMatchObject({ ok: true, delimiter: ';' });
  });

  it('skips blank lines, pads short rows, refuses long rows', () => {
    expect(parseCsv('a,b,c\n\n1,2\n')).toMatchObject({ ok: true, rows: [['1', '2', '']] });
    expect(parseCsv('a,b\n1,2,3\n')).toEqual({ ok: false, code: 'ragged_row', line: 2 });
  });

  it('keeps a formula-looking cell as plain text', () => {
    expect(parseCsv('t\n=HYPERLINK("http://x")\n"@SUM(A1)"')).toMatchObject({ ok: true, rows: [['=HYPERLINK("http://x")'], ['@SUM(A1)']] });
  });

  it('caps size, rows, columns and cell length', () => {
    expect(parseCsv('', 0)).toEqual({ ok: false, code: 'empty' });
    expect(parseCsv('a\n1', MAX_FILE_BYTES + 1)).toEqual({ ok: false, code: 'too_large' });
    expect(parseCsv(['a', ...Array.from({ length: MAX_ROWS + 1 }, () => '1')].join('\n'))).toEqual({ ok: false, code: 'too_many_rows' });
    expect(parseCsv(Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(','))).toMatchObject({ ok: false, code: 'too_many_columns' });
    expect(parseCsv(`a\n${'x'.repeat(MAX_CELL_CHARS + 1)}`)).toMatchObject({ ok: false, code: 'cell_too_long' });
    expect(parseCsv(`a\n"${'x'.repeat(MAX_CELL_CHARS + 1)}"`)).toMatchObject({ ok: false, code: 'cell_too_long' });
  });

  it('refuses an unterminated quote and binary content', () => {
    expect(parseCsv('a\n"oops')).toEqual({ ok: false, code: 'unterminated_quote', line: 2 });
    expect(parseCsv('a\n1\u0000')).toEqual({ ok: false, code: 'binary' });
  });
});
