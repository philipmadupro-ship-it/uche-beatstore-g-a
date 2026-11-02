/**
 * From a parsed distributor file to earnings lines (LABEL-62). Pure.
 *
 * COLUMNS WE UNDERSTAND. Headers are compared case-insensitively with every
 * non-alphanumeric character removed ("Earnings (USD)" → `earningsusd`).
 *
 *  preset      recognised by (all of)         amount                   currency
 *  ----------  -----------------------------  -----------------------  ----------------------------
 *  distrokid   Team Percentage, Song/Album    Earnings (USD)           the "(USD)" in that header
 *  tunecore    Store Name, TC Song ID         Total Earned             `Currency` column, or chosen
 *  cdbaby      Net Earnings, Store            Net Earnings             `Currency` column, or chosen
 *  generic     you name the columns           the one you name         the one you name, or chosen
 *
 * Per preset, the other fields are read from (first header found wins):
 *   isrc       ISRC · Optional ISRC
 *   upc        UPC · Optional UPC
 *   title      Title · Song Title · Release Title
 *   store      Store · Store Name
 *   territory  Country of Sale · Country · Territory
 *   units      Quantity · Units · Number of Streams
 *   period     Sale Month · Sales Period · Posted Date · Period
 * These layouts are modelled on the reports the three services publish; a
 * service that renames a column is handled with the generic mapper, never by
 * guessing.
 *
 * RULES.
 *  - One file = one currency. A row in another currency refuses the WHOLE file
 *    (there is no FX conversion anywhere in Label OS finance). A payee paid in
 *    a different currency than the file is handled later, per line, by the
 *    needs-review queue.
 *  - An amount is read digit by digit into integer minor units. More decimals
 *    than the currency has are refused unless the extra digits are zeros — or
 *    the person ticked "round fractional cents", which rounds each reported
 *    amount half to even and says how many lines it touched. Scientific
 *    notation and anything else that is not a plain number is refused.
 *  - ALL-OR-NOTHING: any bad row refuses the file, naming the first rows. A
 *    half-imported file would make the idempotent re-import impossible.
 *  - A bad or missing identifier is NOT a bad row: the line is kept and goes to
 *    the needs-review queue ("no identifier").
 */
import { normalizeIsrc, normalizeUpc } from '../identifiers';
import { CURRENCY_EXPONENT, divRoundHalfEven, isCurrency } from './money';
import { MAX_ROWS } from './earnings-csv';

export const PRESET_IDS = ['auto', 'distrokid', 'tunecore', 'cdbaby', 'generic'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export type IncomeClass = 'master' | 'publishing';

type Field = 'isrc' | 'upc' | 'title' | 'store' | 'territory' | 'units' | 'amount' | 'currency' | 'period';
type Aliases = Partial<Record<Field, readonly string[]>>;

const COMMON: Aliases = {
  isrc: ['isrc', 'optionalisrc'],
  upc: ['upc', 'optionalupc', 'ean'],
  title: ['title', 'songtitle', 'releasetitle', 'track', 'trackname'],
  store: ['store', 'storename', 'retailer', 'platform'],
  territory: ['countryofsale', 'country', 'territory'],
  units: ['quantity', 'units', 'numberofstreams', 'streams'],
  period: ['salemonth', 'salesperiod', 'posteddate', 'period', 'reportingdate'],
};

export const PRESETS: Readonly<Record<'distrokid' | 'tunecore' | 'cdbaby', { label: string; signature: readonly string[]; aliases: Aliases }>> = {
  distrokid: {
    label: 'DistroKid',
    signature: ['teampercentage', 'songalbum'],
    aliases: { ...COMMON, amount: ['earningsusd', 'earnings'] },
  },
  tunecore: {
    label: 'TuneCore',
    signature: ['storename', 'tcsongid'],
    aliases: { ...COMMON, amount: ['totalearned', 'totalearnings'], currency: ['currency'] },
  },
  cdbaby: {
    label: 'CD Baby',
    signature: ['netearnings', 'store'],
    aliases: { ...COMMON, amount: ['netearnings', 'netamount', 'earnings'], currency: ['currency'] },
  },
};

export const normalizeHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export type GenericMapping = Partial<Record<Field, string>> & { amount: string };

export type ImportOptions = {
  preset: PresetId;
  /** The file's currency when the file does not say (or must be checked against it). */
  currency?: string;
  incomeClass?: IncomeClass;
  /** Round amounts with more decimals than the currency half to even instead of refusing them. */
  roundFractional?: boolean;
  /** Required for `generic`: header text for each field. */
  mapping?: GenericMapping;
};

export type ParsedLine = {
  lineNo: number;
  isrc: string | null;
  upc: string | null;
  title: string | null;
  store: string | null;
  territory: string | null;
  units: number | null;
  grossMinor: bigint;
  periodStart: string | null;
  periodEnd: string | null;
  incomeClass: IncomeClass;
};

export type RowIssue = { lineNo: number; message: string };

export type ImportFailure =
  | { code: 'no_preset'; message: string }
  | { code: 'bad_mapping'; message: string }
  | { code: 'currency_required'; message: string }
  | { code: 'mixed_currency'; message: string }
  | { code: 'bad_rows'; message: string; issues: RowIssue[]; more: number }
  | { code: 'no_rows'; message: string };

export type ImportOk = {
  ok: true;
  preset: Exclude<PresetId, 'auto'>;
  currency: string;
  lines: ParsedLine[];
  totalMinor: bigint;
  /** Lines whose amount was rounded because the file had more decimals than the currency. */
  roundedLines: number;
};

const MAX_ISSUES = 10;

// ── Amounts ──────────────────────────────────────────────────────────────

/**
 * "12.34", "1,234.50", "0,0031" (decimal comma), "(5.00)" (negative), "-3", "$7".
 * Returns the integer minor units, or null when the text is not a plain number
 * or has excess decimals that are not zeros (and rounding was not allowed).
 */
export function parseAmount(raw: string, exponent: number, round: boolean): { minor: bigint; rounded: boolean } | null {
  let t = raw.trim().replace(/^[$€£¥]\s*/, '').replace(/\s+/g, '');
  let neg = false;
  const paren = /^\((.*)\)$/.exec(t);
  if (paren) {
    neg = true;
    t = paren[1];
  }
  if (t.startsWith('-')) {
    neg = !neg;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  if (t === '') return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let whole: string;
  let frac = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    const dec = t[decimalAt];
    const group = dec === '.' ? ',' : '.';
    whole = t.slice(0, decimalAt).split(group).join('');
    frac = t.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    // One kind of separator. "1,234" and "1,234,567" are grouping; "12,50" and "0,0031" are a decimal comma.
    const parts = t.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1 && parts[0] !== '0')) {
      whole = parts.join('');
    } else {
      whole = parts[0];
      frac = parts[1] ?? '';
    }
  } else if (lastDot >= 0) {
    whole = t.slice(0, lastDot);
    frac = t.slice(lastDot + 1);
    if (whole.includes('.')) return null;
  } else {
    whole = t;
  }
  if (whole === '') whole = '0';
  if (!/^\d+$/.test(whole) || (frac !== '' && !/^\d+$/.test(frac))) return null;
  if (whole.length > 15) return null;
  let rounded = false;
  let minor: bigint;
  if (frac.length <= exponent) {
    minor = BigInt(whole + frac.padEnd(exponent, '0'));
  } else {
    const kept = frac.slice(0, exponent);
    const excess = frac.slice(exponent);
    if (/^0*$/.test(excess)) {
      minor = BigInt(whole + kept);
    } else if (!round) {
      return null;
    } else {
      minor = divRoundHalfEven(BigInt(whole + frac), BigInt(10) ** BigInt(frac.length - exponent));
      rounded = true;
    }
  }
  return { minor: neg ? -minor : minor, rounded };
}

// ── Periods ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "2026-09" | "2026-09-14" | "2026/09" | "09/2026" | "2026-09-14T…" → start/end dates, else nulls. */
export function parsePeriod(raw: string): { start: string | null; end: string | null } {
  const t = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(t) ?? (/^(\d{1,2})[-/](\d{4})$/.exec(t) ? ([, ...(/^(\d{1,2})[-/](\d{4})$/.exec(t) as RegExpExecArray).slice(1).reverse()] as unknown as RegExpExecArray) : null);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return { start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` };
    return { start: null, end: null };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= lastDay(y, mo)) return { start: `${y}-${pad(mo)}-${pad(d)}`, end: `${y}-${pad(mo)}-${pad(d)}` };
  }
  return { start: null, end: null };
}

// ── Text ─────────────────────────────────────────────────────────────────

/** Control characters out, trimmed, capped. Never interpreted. */
function text(raw: string | undefined, max: number): string | null {
  const t = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t === '' ? null : t.slice(0, max);
}

// ── The mapper ───────────────────────────────────────────────────────────

function findIndex(keys: readonly string[], aliases: readonly string[] | undefined): number {
  for (const a of aliases ?? []) {
    const i = keys.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

export function detectPreset(header: readonly string[]): Exclude<PresetId, 'auto' | 'generic'> | null {
  const keys = header.map(normalizeHeader);
  for (const id of ['distrokid', 'tunecore', 'cdbaby'] as const) {
    if (PRESETS[id].signature.every((s) => keys.includes(s))) return id;
  }
  return null;
}

type Columns = Record<Field, number>;

function resolveColumns(
  header: readonly string[],
  preset: Exclude<PresetId, 'auto'>,
  mapping: GenericMapping | undefined,
): { ok: true; columns: Columns; headerCurrency: string | null } | { ok: false; failure: ImportFailure } {
  const keys = header.map(normalizeHeader);
  const none: Columns = { isrc: -1, upc: -1, title: -1, store: -1, territory: -1, units: -1, amount: -1, currency: -1, period: -1 };
  if (preset === 'generic') {
    if (!mapping) return { ok: false, failure: { code: 'bad_mapping', message: 'Tell us which column holds the amount.' } };
    const columns = { ...none };
    for (const [field, headerText] of Object.entries(mapping) as [Field, string | undefined][]) {
      if (!headerText) continue;
      const i = keys.indexOf(normalizeHeader(headerText));
      if (i < 0) return { ok: false, failure: { code: 'bad_mapping', message: `There is no column called “${headerText.slice(0, 60)}” in this file.` } };
      columns[field] = i;
    }
    if (columns.amount < 0) return { ok: false, failure: { code: 'bad_mapping', message: 'Tell us which column holds the amount.' } };
    if (columns.isrc < 0 && columns.upc < 0) return { ok: false, failure: { code: 'bad_mapping', message: 'Name the ISRC or the UPC column: lines are matched to recordings by them.' } };
    return { ok: true, columns, headerCurrency: null };
  }
  const aliases = PRESETS[preset].aliases;
  const columns = { ...none };
  for (const field of Object.keys(none) as Field[]) columns[field] = findIndex(keys, aliases[field]);
  if (columns.amount < 0) return { ok: false, failure: { code: 'bad_mapping', message: `This does not look like a ${PRESETS[preset].label} report: there is no earnings column.` } };
  if (columns.isrc < 0 && columns.upc < 0) return { ok: false, failure: { code: 'bad_mapping', message: 'The file has neither an ISRC nor a UPC column: lines cannot be matched.' } };
  const m = /\(([A-Za-z]{3})\)\s*$/.exec(header[columns.amount]);
  return { ok: true, columns, headerCurrency: m ? m[1].toUpperCase() : null };
}

export function buildLines(header: readonly string[], rows: readonly (readonly string[])[], options: ImportOptions): ImportOk | { ok: false; failure: ImportFailure } {
  let preset: Exclude<PresetId, 'auto'>;
  if (options.preset === 'auto') {
    const d = detectPreset(header);
    if (!d) return { ok: false, failure: { code: 'no_preset', message: 'We could not tell which service made this file. Pick DistroKid, TuneCore or CD Baby, or map the columns yourself.' } };
    preset = d;
  } else preset = options.preset;

  const resolved = resolveColumns(header, preset, options.mapping);
  if (!resolved.ok) return resolved;
  const { columns, headerCurrency } = resolved;
  const wanted = options.currency?.toUpperCase();
  if (wanted !== undefined && !isCurrency(wanted)) return { ok: false, failure: { code: 'currency_required', message: `“${options.currency}” is not a currency we can handle.` } };

  // The file's currency: the chosen one, else the header's, else the column's (every row must agree).
  const cell = (r: readonly string[], i: number): string => (i >= 0 ? r[i] ?? '' : '');
  const rowCurrencies = new Set<string>();
  if (columns.currency >= 0) for (const r of rows) { const c = cell(r, columns.currency).trim().toUpperCase(); if (c) rowCurrencies.add(c); }
  const candidates = new Set<string>([...(wanted ? [wanted] : []), ...(headerCurrency ? [headerCurrency] : []), ...rowCurrencies]);
  if (candidates.size === 0) return { ok: false, failure: { code: 'currency_required', message: 'The file does not say which currency it is in. Choose it.' } };
  if (candidates.size > 1) {
    return {
      ok: false,
      failure: { code: 'mixed_currency', message: `This file mixes currencies (${[...candidates].sort().join(', ')}). Amounts in different currencies are never combined: export one file per currency.` },
    };
  }
  const currency = [...candidates][0];
  if (!isCurrency(currency)) return { ok: false, failure: { code: 'currency_required', message: `“${currency}” is not a currency we can handle.` } };
  const exponent = CURRENCY_EXPONENT[currency];

  const incomeClass: IncomeClass = options.incomeClass ?? 'master';
  const lines: ParsedLine[] = [];
  const issues: RowIssue[] = [];
  let more = 0;
  let roundedLines = 0;
  let total = BigInt(0);
  const bad = (lineNo: number, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ lineNo, message });
    else more++;
  };

  rows.forEach((r, idx) => {
    if (r.every((c) => c.trim() === '')) return;
    const lineNo = idx + 2; // the header is line 1
    const amountText = cell(r, columns.amount);
    const amount = parseAmount(amountText, exponent, options.roundFractional === true);
    if (amount === null) {
      bad(lineNo, amountText.trim() === '' ? 'the amount is empty' : `“${amountText.trim().slice(0, 30)}” is not an amount${/\d[.,]\d{3,}/.test(amountText) ? ' with at most ' + exponent + ' decimals (tick “round fractional cents” to round it)' : ''}`);
      return;
    }
    let units: number | null = null;
    const unitsText = cell(r, columns.units).trim().replace(/,/g, '');
    if (unitsText !== '') {
      if (!/^\d{1,12}$/.test(unitsText)) {
        bad(lineNo, `“${unitsText.slice(0, 20)}” is not a unit count`);
        return;
      }
      units = Number(unitsText);
    }
    const isrcRaw = cell(r, columns.isrc).trim();
    const upcRaw = cell(r, columns.upc).trim();
    const period = columns.period >= 0 ? parsePeriod(cell(r, columns.period)) : { start: null, end: null };
    if (amount.rounded) roundedLines++;
    total += amount.minor;
    lines.push({
      lineNo,
      isrc: isrcRaw ? normalizeIsrc(isrcRaw) : null,
      upc: upcRaw ? normalizeUpc(upcRaw) : null,
      title: text(cell(r, columns.title), 300),
      store: text(cell(r, columns.store), 80),
      territory: text(cell(r, columns.territory), 40),
      units,
      grossMinor: amount.minor,
      periodStart: period.start,
      periodEnd: period.end,
      incomeClass,
    });
  });

  if (issues.length > 0) {
    return { ok: false, failure: { code: 'bad_rows', message: `${issues.length + more} row${issues.length + more === 1 ? '' : 's'} could not be read. Nothing was imported.`, issues, more } };
  }
  if (lines.length === 0) return { ok: false, failure: { code: 'no_rows', message: 'The file has no earnings rows.' } };
  if (lines.length > MAX_ROWS) return { ok: false, failure: { code: 'no_rows', message: 'The file has too many rows.' } };
  return { ok: true, preset, currency, lines, totalMinor: total, roundedLines };
}
