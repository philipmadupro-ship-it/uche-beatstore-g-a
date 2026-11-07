/**
 * Merge fields (LABEL-57): the named values a template's clauses ask for.
 * Pure. A clause body writes `{{key}}`; the renderer fills it from the
 * contract. Three families of key:
 *
 *   field keys   `advance`, `royalty_rate`, … — typed values the person fills
 *                in (`contracts.fields`), validated by kind below.
 *   built-ins    `contract.title`, `contract.effective_date`, `contract.term`,
 *                `contract.territory`, `artist.name`, `song.title`,
 *                `release.title` — read from the contract's own columns.
 *   party keys   `party.<role>` (the names of the parties in that role) and
 *                `party.<role>.address` — read from LABEL-54's `parties`.
 *                Only the NAME and ADDRESS of a party ever reach a document:
 *                tax id and payment instructions are finance's and are not
 *                merge fields (no key exists for them, so a template cannot ask).
 *
 * Money and percentages are strings in the stored fields, validated digit by
 * digit and never turned into floats (a share is an integer in this app; the
 * splits linkage, LABEL-59, depends on it).
 */
import { PARTY_ROLES, type PartyRole } from './types';

export const FIELD_KINDS = ['text', 'money', 'percent', 'date', 'number', 'currency'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export type MergeField = {
  key: string;
  label: string;
  kind: FieldKind;
  /** Shown under the input. */
  hint?: string;
  /** What the template preview shows. */
  sample: string;
};

export const MERGE_FIELDS: readonly MergeField[] = [
  { key: 'currency', label: 'Currency', kind: 'currency', hint: 'Three letters, e.g. USD', sample: 'USD' },
  { key: 'advance', label: 'Advance', kind: 'money', hint: 'Amount, no currency sign', sample: '25000' },
  { key: 'fee', label: 'Fee', kind: 'money', hint: 'Flat fee, no currency sign', sample: '1500' },
  { key: 'royalty_rate', label: 'Royalty rate (%)', kind: 'percent', hint: 'Up to four decimals', sample: '18.5' },
  { key: 'master_share', label: 'Master share (%)', kind: 'percent', hint: 'The party’s share of the master', sample: '50' },
  { key: 'publishing_share', label: 'Publishing share (%)', kind: 'percent', hint: 'The party’s share of the composition', sample: '50' },
  { key: 'commission_rate', label: 'Commission (%)', kind: 'percent', sample: '15' },
  { key: 'option_periods', label: 'Option periods', kind: 'number', hint: 'How many', sample: '2' },
  { key: 'minimum_delivery', label: 'Minimum delivery (records)', kind: 'number', sample: '1' },
  { key: 'delivery_date', label: 'Delivery date', kind: 'date', sample: '2027-03-01' },
  { key: 'notice_days', label: 'Notice (days)', kind: 'number', sample: '30' },
  { key: 'confidentiality_years', label: 'Confidentiality period (years)', kind: 'number', sample: '3' },
  { key: 'exclusivity', label: 'Exclusivity', kind: 'text', hint: 'e.g. exclusive, non-exclusive', sample: 'exclusive' },
  { key: 'usage', label: 'Permitted use', kind: 'text', hint: 'Media and use', sample: 'a feature film and its trailer' },
  { key: 'sample_source', label: 'Sampled work', kind: 'text', sample: '“Example Song” by Example Artist' },
  { key: 'deliverables', label: 'Deliverables', kind: 'text', sample: 'a mixed stereo master and instrumental' },
  { key: 'credit_line', label: 'Credit line', kind: 'text', sample: 'Produced by Example Producer' },
  { key: 'governing_law', label: 'Governing law', kind: 'text', sample: 'the laws of England and Wales' },
  { key: 'lease_type', label: 'Lease type', kind: 'text', hint: 'e.g. non-exclusive lease', sample: 'non-exclusive lease' },
  { key: 'stream_limit', label: 'Stream limit', kind: 'number', sample: '500000' },
];

const FIELD_BY_KEY: ReadonlyMap<string, MergeField> = new Map(MERGE_FIELDS.map((f) => [f.key, f]));

export function mergeField(key: string): MergeField | undefined {
  return FIELD_BY_KEY.get(key);
}

export const BUILTIN_KEYS = [
  'contract.title',
  'contract.effective_date',
  'contract.term',
  'contract.territory',
  'artist.name',
  'song.title',
  'release.title',
] as const;
export type BuiltinKey = (typeof BUILTIN_KEYS)[number];

export const BUILTIN_SAMPLES: Readonly<Record<BuiltinKey, string>> = {
  'contract.title': 'Sample agreement',
  'contract.effective_date': '1 January 2027',
  'contract.term': '24 months',
  'contract.territory': 'Worldwide',
  'artist.name': 'Example Artist',
  'song.title': 'Example Song',
  'release.title': 'Example Release',
};

const PARTY_KEY = /^party\.([a-z_]+)(\.address)?$/;

/** What a key is, or null when no such key exists. */
export type KeyKind =
  | { type: 'field'; field: MergeField }
  | { type: 'builtin'; key: BuiltinKey }
  | { type: 'party'; role: PartyRole; address: boolean };

export function classifyKey(key: string): KeyKind | null {
  const field = FIELD_BY_KEY.get(key);
  if (field) return { type: 'field', field };
  if ((BUILTIN_KEYS as readonly string[]).includes(key)) return { type: 'builtin', key: key as BuiltinKey };
  const m = PARTY_KEY.exec(key);
  if (m && (PARTY_ROLES as readonly string[]).includes(m[1])) return { type: 'party', role: m[1] as PartyRole, address: m[2] === '.address' };
  return null;
}

// ── Tokens in a text ─────────────────────────────────────────────────────

const TOKEN = /\{\{\s*([a-z0-9_.]+)\s*\}\}/g;

/** Every `{{key}}` in a text, in order, once each. */
export function tokensIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(TOKEN)) seen.add(m[1]);
  return [...seen];
}

/** Keys in a text that no merge field, built-in or party role defines. */
export function unknownTokens(text: string): string[] {
  return tokensIn(text).filter((k) => classifyKey(k) === null);
}

/** The typed field keys (not built-ins, not party keys) a text asks for. */
export function fieldKeysIn(text: string): string[] {
  return tokensIn(text).filter((k) => classifyKey(k)?.type === 'field');
}

// ── Validation of a value by kind ────────────────────────────────────────

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const PERCENT = /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/;
const NUMBER = /^\d{1,9}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TEXT_FIELD_MAX = 500;

function isIsoDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The problem with a value for this kind, or null when it is fine. An empty string is "not filled in yet" and is fine. */
export function fieldValueError(field: MergeField, value: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  switch (field.kind) {
    case 'money':
      return MONEY.test(v) ? null : `${field.label} must be an amount like 2500 or 2500.50`;
    case 'percent':
      return PERCENT.test(v) ? null : `${field.label} must be a number from 0 to 100 with at most four decimals`;
    case 'number':
      return NUMBER.test(v) ? null : `${field.label} must be a whole number`;
    case 'currency':
      return CURRENCY.test(v) ? null : `${field.label} must be three capital letters`;
    case 'date':
      return isIsoDate(v) ? null : `${field.label} must be a date like 2027-03-01`;
    case 'text':
      return v.length <= TEXT_FIELD_MAX ? null : `${field.label} is too long (${TEXT_FIELD_MAX} characters at most)`;
  }
}

export type FieldValues = Record<string, string>;
export type FieldsResult = { ok: true; fields: FieldValues } | { ok: false; error: string };

/**
 * A request's `fields` object turned into the stored one: only known field
 * keys, trimmed, empty values dropped, each validated by its kind. The first
 * problem is reported. Unknown keys are an error, not silently dropped — a
 * typo would otherwise vanish.
 */
export function cleanFields(raw: Record<string, unknown>): FieldsResult {
  const out: FieldValues = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) return { ok: false, error: `Unknown field "${key}"` };
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string') return { ok: false, error: `${field.label} must be text` };
    const problem = fieldValueError(field, value);
    if (problem) return { ok: false, error: problem };
    const v = value.trim();
    if (v !== '') out[key] = v;
  }
  return { ok: true, fields: out };
}
