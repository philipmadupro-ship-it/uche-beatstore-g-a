import { describe, expect, it } from 'vitest';
import { parseCsv } from './earnings-csv';
import { buildLines, detectPreset, parseAmount, parsePeriod } from './earnings-import';

const csv = (s: string) => {
  const r = parseCsv(s);
  if (!r.ok) throw new Error(r.code);
  return r;
};
const amt = (s: string, exp = 2, round = false) => parseAmount(s, exp, round);

describe('parseAmount', () => {
  it('reads plain, grouped, decimal-comma, negative and symbol amounts into minor units', () => {
    expect(amt('12.34')?.minor).toBe(BigInt(1234));
    expect(amt('1,234.5')?.minor).toBe(BigInt(123450));
    expect(amt('1.234,56')?.minor).toBe(BigInt(123456));
    expect(amt('12,50')?.minor).toBe(BigInt(1250));
    expect(amt('1,234')?.minor).toBe(BigInt(123400));
    expect(amt('1,234,567')?.minor).toBe(BigInt(123456700));
    expect(amt('0,0000', 2)?.minor).toBe(BigInt(0));
    expect(amt('0,0030', 2)).toBeNull();
    expect(amt('(5.00)')?.minor).toBe(BigInt(-500));
    expect(amt('-3')?.minor).toBe(BigInt(-300));
    expect(amt('$7')?.minor).toBe(BigInt(700));
    expect(amt('.5')?.minor).toBe(BigInt(50));
    expect(amt('500', 0)?.minor).toBe(BigInt(500));
  });

  it('accepts excess decimals only when they are zeros, or when rounding is allowed (half to even)', () => {
    expect(amt('12.340000')?.minor).toBe(BigInt(1234));
    expect(amt('0.00312')).toBeNull();
    expect(amt('0.00312', 2, true)).toEqual({ minor: BigInt(0), rounded: true });
    expect(amt('0.005', 2, true)?.minor).toBe(BigInt(0)); // tie → even (0)
    expect(amt('0.015', 2, true)?.minor).toBe(BigInt(2)); // tie → even (2)
    expect(amt('0.025', 2, true)?.minor).toBe(BigInt(2));
    expect(amt('-0.015', 2, true)?.minor).toBe(BigInt(-2));
    expect(amt('0.0151', 2, true)?.minor).toBe(BigInt(2));
  });

  it('refuses everything that is not a plain number', () => {
    for (const bad of ['', 'abc', '1e-5', '1.2.3', '=1+1', '12 USD', '--1', '1,2,3x', '9'.repeat(16)]) expect(amt(bad), bad).toBeNull();
  });
});

describe('parsePeriod', () => {
  it('reads months and days', () => {
    expect(parsePeriod('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(parsePeriod('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(parsePeriod('09/2026')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(parsePeriod('2026-09-14')).toEqual({ start: '2026-09-14', end: '2026-09-14' });
    expect(parsePeriod('2026-09-14T00:00:00Z')).toEqual({ start: '2026-09-14', end: '2026-09-14' });
    expect(parsePeriod('2026-13')).toEqual({ start: null, end: null });
    expect(parsePeriod('2026-02-30')).toEqual({ start: null, end: null });
    expect(parsePeriod('last month')).toEqual({ start: null, end: null });
  });
});

const DK = 'Reporting Date,Sale Month,Store,Artist,Title,ISRC,UPC,Quantity,Team Percentage,Song/Album,Country of Sale,Songwriter Royalties Withheld,Earnings (USD)\n' +
  '2026-10-01,2026-09,Spotify,Ara,Night Shift,US-ABC-26-00001,,"1,200",100,Song,US,0,"3.456789"\n' +
  '2026-10-01,2026-09,Apple Music,Ara,Night Shift,USABC2600001,,10,100,Song,GB,0,0.5\n' +
  '2026-10-01,2026-09,Spotify,Ara,Mystery,,,5,100,Song,US,0,1.10\n';

describe('buildLines', () => {
  it('detects DistroKid, reads the USD from the header, and refuses fractional cents unless asked', () => {
    const { header, rows } = csv(DK);
    expect(detectPreset(header)).toBe('distrokid');
    const refused = buildLines(header, rows, { preset: 'auto' });
    expect(refused).toMatchObject({ ok: false, failure: { code: 'bad_rows' } });
    const ok = buildLines(header, rows, { preset: 'auto', roundFractional: true });
    expect(ok).toMatchObject({ ok: true, preset: 'distrokid', currency: 'USD', roundedLines: 1, totalMinor: BigInt(346 + 50 + 110) });
    if (!ok.ok) return;
    expect(ok.lines[0]).toMatchObject({ lineNo: 2, isrc: 'USABC2600001', units: 1200, periodStart: '2026-09-01', periodEnd: '2026-09-30', territory: 'US', store: 'Spotify', incomeClass: 'master' });
    expect(ok.lines[2].isrc).toBeNull();
  });

  it('reads TuneCore-style and CD Baby-style files with a Currency column or a chosen currency', () => {
    const tc = csv('Posted Date,Sales Period,Store Name,Artist,Release Title,Song Title,Label,UPC,Optional UPC,TC Song ID,Optional ISRC,Country of Sale,Quantity,Total Earned,Currency\n2026-10-02,2026-09,Spotify,Ara,EP,Night Shift,L,,,1,USABC2600001,US,10,2.50,EUR\n');
    expect(buildLines(tc.header, tc.rows, { preset: 'auto' })).toMatchObject({ ok: true, preset: 'tunecore', currency: 'EUR', totalMinor: BigInt(250) });
    const cd = csv('Sale Month,Store,Country,Artist,Title,ISRC,UPC,Units,Net Earnings\n2026-09,Spotify,US,Ara,Night Shift,USABC2600001,,3,4.00\n');
    expect(buildLines(cd.header, cd.rows, { preset: 'auto' })).toMatchObject({ ok: false, failure: { code: 'currency_required' } });
    expect(buildLines(cd.header, cd.rows, { preset: 'auto', currency: 'gbp' })).toMatchObject({ ok: true, preset: 'cdbaby', currency: 'GBP', totalMinor: BigInt(400) });
  });

  it('refuses a file that mixes currencies, or disagrees with the chosen one', () => {
    const f = csv('ISRC,Amount,Currency\nUSABC2600001,1.00,USD\nUSABC2600002,1.00,EUR\n');
    const map = { preset: 'generic' as const, mapping: { isrc: 'ISRC', amount: 'Amount', currency: 'Currency' } };
    expect(buildLines(f.header, f.rows, map)).toMatchObject({ ok: false, failure: { code: 'mixed_currency' } });
    const g = csv('ISRC,Amount,Currency\nUSABC2600001,1.00,USD\n');
    expect(buildLines(g.header, g.rows, { ...map, currency: 'EUR' })).toMatchObject({ ok: false, failure: { code: 'mixed_currency' } });
  });

  it('the generic mapper names its own columns, and a bad mapping is a clear error', () => {
    const f = csv('Code;Net;Where\nUS-ABC-26-00001;1,50;US\n');
    const r = buildLines(f.header, f.rows, { preset: 'generic', currency: 'USD', mapping: { isrc: 'Code', amount: 'Net', territory: 'Where' } });
    expect(r).toMatchObject({ ok: true, totalMinor: BigInt(150) });
    expect(buildLines(f.header, f.rows, { preset: 'generic', currency: 'USD', mapping: { isrc: 'Nope', amount: 'Net' } })).toMatchObject({ ok: false, failure: { code: 'bad_mapping' } });
    expect(buildLines(f.header, f.rows, { preset: 'generic', currency: 'USD', mapping: { amount: 'Net' } })).toMatchObject({ ok: false, failure: { code: 'bad_mapping' } });
    expect(buildLines(f.header, f.rows, { preset: 'auto', currency: 'USD' })).toMatchObject({ ok: false, failure: { code: 'no_preset' } });
  });

  it('is all-or-nothing: a bad row refuses the file and names the line', () => {
    const f = csv('ISRC,Amount\nUSABC2600001,1.00\nUSABC2600002,oops\n');
    const r = buildLines(f.header, f.rows, { preset: 'generic', currency: 'USD', mapping: { isrc: 'ISRC', amount: 'Amount' } });
    expect(r).toMatchObject({ ok: false, failure: { code: 'bad_rows', issues: [{ lineNo: 3 }] } });
  });

  it('keeps formula-looking text as inert text and strips control characters', () => {
    const f = csv('ISRC,Amount,Title\nUSABC2600001,1.00,"=cmd|\'/c calc\'!A0\u0007"\n');
    const r = buildLines(f.header, f.rows, { preset: 'generic', currency: 'USD', mapping: { isrc: 'ISRC', amount: 'Amount', title: 'Title' } });
    expect(r.ok && r.lines[0].title).toBe("=cmd|'/c calc'!A0");
  });

  it('keeps a line with a malformed identifier (it goes to review) and skips blank rows', () => {
    const f = csv('ISRC,Amount\nBAD,1.00\n,\n');
    const r = buildLines(f.header, f.rows, { preset: 'generic', currency: 'USD', mapping: { isrc: 'ISRC', amount: 'Amount' } });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.lines).toHaveLength(1);
    expect(r.ok && r.lines[0].isrc).toBeNull();
  });
});
