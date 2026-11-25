/**
 * Automatic check of license-tier terms (LICENSE-03).
 *
 * Pure and deterministic: no network, no model, same input → same output. It
 * looks for combinations a producer usually did not mean (a free tier that
 * grants sync, an exclusive that delivers no WAV, a pricier tier that gives
 * less than a cheaper one) and says so in plain words with one suggestion.
 *
 * It is a CHECK, not legal advice, and every message is worded as "usually" /
 * "check" rather than a verdict. Nothing here blocks saving.
 *
 * Rights columns read as three states, like `tierTermsFromRow`: `null` means
 * "not specified" and never counts as false. A rule about a right being
 * absent fires only on an explicit `false`; a rule about a right being
 * granted fires only on an explicit `true`.
 */
import { tierTermsFromRow, type TierTerms } from '@/lib/contracts/license-terms';
import { TERM_KEYS } from '@/lib/contracts/license-terms';

export type Severity = 'risk' | 'warn' | 'info';

export type FindingCode =
  | 'NO_FILES' | 'NAME_MISSING' | 'FREE_EXCLUSIVE' | 'FREE_SYNC' | 'FREE_UNLIMITED'
  | 'PRICE_ZERO_NOT_FREE' | 'FREE_PRICE_SET'
  | 'EXCLUSIVE_NO_WAV' | 'EXCLUSIVE_NO_STEMS' | 'EXCLUSIVE_LIMITED'
  | 'STEMS_FLAG_NO_FILE' | 'STEMS_FILE_NO_FLAG'
  | 'CHEAP_UNLIMITED' | 'CHEAP_SYNC' | 'NO_COMMERCIAL_BUT_PAID_RIGHTS' | 'LIMIT_MISMATCH'
  | 'CREDIT_NO_WORDING' | 'CREDIT_CLAUSE_UNUSED' | 'TEMPLATE_MISSING_TERMS'
  | 'TIER_NOT_ABOVE_CHEAPER' | 'TIER_PRICE_INVERSION' | 'TIER_DUPLICATE_TERMS' | 'TIER_DUPLICATE_NAME';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** The licenses column (or 'template') the finding is about. */
  field: string;
  message: string;
  suggestion: string;
  /** Absent for findings about the template or the set as a whole. */
  tierId?: string;
}

/** A tier as the builder holds it: the terms plus what the row needs to be compared. */
export interface TierDraft extends TierTerms {
  id: string;
  price_usd: number;
  is_free: boolean;
}

export interface AnalysisSummary {
  risk: number;
  warn: number;
  info: number;
  text: string;
}

export interface ComparisonRow {
  id: string;
  name: string;
  line: string;
}

export interface Analysis {
  findings: Finding[];
  perTier: Record<string, Finding[]>;
  /** Findings that belong to the template or the set, not to one tier. */
  general: Finding[];
  summary: AnalysisSummary;
  comparison: ComparisonRow[];
}

/** Heuristic thresholds, in US dollars. They are prompts to look again, not rules. */
export const CHEAP_LEASE_MAX_USD = 50;
export const CHEAP_SYNC_MAX_USD = 100;

export const DISCLAIMER = 'Automatic check — not legal advice.';

/** A `licenses` row (or a draft of one) as a tier draft. Missing columns read as "not specified". */
export function tierDraftFromRow(row: Record<string, unknown>): TierDraft {
  const price = Number(row.price_usd);
  return {
    ...tierTermsFromRow(row, row.is_exclusive === true ? 'exclusive' : 'lease'),
    id: String(row.id ?? ''),
    price_usd: Number.isFinite(price) && price > 0 ? price : 0,
    is_free: row.is_free === true,
  };
}

// ── Template ────────────────────────────────────────────────────────────────

/** True when the template can say anything about credit: the placeholder or a credit clause. */
export function templateHasCreditWording(template: string): boolean {
  return template.includes('{{credit_requirement}}') || /\{\{#if\s+credit_required\s*\}\}/.test(template);
}

function mentionsTierTerms(template: string): boolean {
  return TERM_KEYS.some((k) => template.includes(`{{${k}}}`)) || template.includes('{{#if ') || template.includes('{{#unless ');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const has = (t: TierDraft, ft: string) => t.file_types.includes(ft);
const effectivePrice = (t: TierDraft) => (t.is_free ? 0 : t.price_usd);
const cap = (n: number | null) => (n === null ? Number.POSITIVE_INFINITY : n);
const label = (t: TierDraft) => t.name.trim() || 'Untitled';
const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function capText(n: number | null): string {
  return n === null ? 'unlimited' : n.toLocaleString('en-US');
}

/** True when `a` grants at least what `b` does on every axis the builder has. */
function covers(a: TierDraft, b: TierDraft): boolean {
  return b.file_types.every((f) => a.file_types.includes(f))
    && (a.stems_included || !b.stems_included)
    && cap(a.streaming_limit) >= cap(b.streaming_limit)
    && cap(a.distribution_limit) >= cap(b.distribution_limit)
    && (a.commercial_rights === true || b.commercial_rights !== true)
    && (a.sync_rights === true || b.sync_rights !== true)
    && (a.broadcast_rights === true || b.broadcast_rights !== true);
}

function sameTerms(a: TierDraft, b: TierDraft): boolean {
  return covers(a, b) && covers(b, a) && a.is_exclusive === b.is_exclusive;
}

// ── Per-tier rules ──────────────────────────────────────────────────────────

function tierFindings(t: TierDraft, template: string): Finding[] {
  const out: Finding[] = [];
  const add = (code: FindingCode, severity: Severity, field: string, message: string, suggestion: string) =>
    out.push({ code, severity, field, message, suggestion, tierId: t.id });
  const price = effectivePrice(t);
  const grantsPaidRights = t.sync_rights === true || t.broadcast_rights === true;

  if (!t.name.trim() || t.name.trim().toLowerCase() === 'untitled') {
    add('NAME_MISSING', 'warn', 'name', 'This tier has no name, so buyers will see "Untitled".', 'Give it a short name such as "MP3 Lease".');
  }
  if (t.file_types.length === 0) {
    add('NO_FILES', 'risk', 'file_types', 'No files are included, so there is nothing to deliver.', 'Tick at least one file type, usually MP3.');
  }
  if (t.is_free && t.is_exclusive) {
    add('FREE_EXCLUSIVE', 'risk', 'is_exclusive', 'A free tier is marked exclusive: one person would get exclusive rights for nothing.', 'Turn exclusive off, or give the tier a price.');
  }
  if (t.is_free && grantsPaidRights) {
    add('FREE_SYNC', 'warn', 'sync_rights', 'A free tier grants sync or broadcast rights, which are usually sold.', 'Turn off sync / broadcast on the free tier.');
  }
  if (t.is_free && !t.is_exclusive && t.streaming_limit === null) {
    add('FREE_UNLIMITED', 'warn', 'streaming_limit', 'A free tier has unlimited streams.', 'Set a streaming limit on the free tier.');
  }
  if (!t.is_free && t.price_usd === 0) {
    add('PRICE_ZERO_NOT_FREE', 'warn', 'price_usd', 'The price is 0 but the tier is not marked free.', 'Enter a price, or mark the tier free.');
  }
  if (t.is_free && t.price_usd > 0) {
    add('FREE_PRICE_SET', 'info', 'price_usd', `The tier is marked free, so its price of ${money(t.price_usd)} is not charged.`, 'Clear the free flag, or set the price to 0.');
  }

  if (t.is_exclusive) {
    if (!has(t, 'WAV') && !has(t, 'STEMS')) {
      add('EXCLUSIVE_NO_WAV', 'risk', 'file_types', 'Exclusive buyers usually expect the WAV; this tier delivers no WAV or stems.', 'Add WAV (and stems if you sell them) to the files.');
    } else if (!t.stems_included && !has(t, 'STEMS')) {
      add('EXCLUSIVE_NO_STEMS', 'info', 'stems_included', 'Exclusive tiers often include stems; this one does not.', 'Include stems, or say in the description that they are not part of it.');
    }
    if (t.streaming_limit !== null || t.distribution_limit !== null) {
      add('EXCLUSIVE_LIMITED', 'warn', 'streaming_limit', 'An exclusive tier has a streaming or distribution cap, which usually conflicts with exclusive rights.', 'Set both limits to unlimited, or turn exclusive off.');
    }
  } else if (!t.is_free) {
    if (price < CHEAP_LEASE_MAX_USD && t.streaming_limit === null) {
      add('CHEAP_UNLIMITED', 'warn', 'streaming_limit', `A non-exclusive tier under ${money(CHEAP_LEASE_MAX_USD)} has unlimited streams.`, 'Cap the streams, or raise the price.');
    }
    if (price < CHEAP_SYNC_MAX_USD && t.sync_rights === true) {
      add('CHEAP_SYNC', 'warn', 'sync_rights', `A non-exclusive tier under ${money(CHEAP_SYNC_MAX_USD)} grants sync rights.`, 'Keep sync for a higher tier, or raise the price.');
    }
  }

  if (t.stems_included && !has(t, 'STEMS')) {
    add('STEMS_FLAG_NO_FILE', 'warn', 'file_types', 'Stems are marked included, but STEMS is not in the files.', 'Tick STEMS in the files, or turn stems off.');
  } else if (!t.stems_included && has(t, 'STEMS')) {
    add('STEMS_FILE_NO_FLAG', 'warn', 'stems_included', 'STEMS is in the files, but stems are not marked included.', 'Turn on Stems Included, or remove STEMS from the files.');
  }
  if (t.commercial_rights === false && grantsPaidRights) {
    add('NO_COMMERCIAL_BUT_PAID_RIGHTS', 'warn', 'commercial_rights', 'Commercial use is off, but sync or broadcast is on. Those are commercial uses.', 'Turn commercial use on, or turn sync / broadcast off.');
  }
  if (t.streaming_limit !== null && t.distribution_limit !== null && t.distribution_limit > t.streaming_limit) {
    add('LIMIT_MISMATCH', 'info', 'distribution_limit', 'The distribution limit is higher than the streaming limit.', 'Check the two limits are the way round you intended.');
  }
  if (t.credit_required && template.trim() && !templateHasCreditWording(template)) {
    add('CREDIT_NO_WORDING', 'info', 'credit_required', 'Credit is required, but your contract template has no credit wording.', 'Add {{credit_requirement}} or a credit clause to the License Contract.');
  }
  return out;
}

// ── Set rules ───────────────────────────────────────────────────────────────

function setFindings(tiers: TierDraft[], template: string): Finding[] {
  const out: Finding[] = [];
  const seenName = new Map<string, TierDraft>();
  tiers.forEach((t, i) => {
    const key = t.name.trim().toLowerCase();
    if (key) {
      const first = seenName.get(key);
      if (first) {
        out.push({ code: 'TIER_DUPLICATE_NAME', severity: 'warn', field: 'name', tierId: t.id,
          message: `Another tier is also called "${label(first)}".`, suggestion: 'Give each tier its own name so buyers can tell them apart.' });
      } else seenName.set(key, t);
    }
    for (let j = 0; j < i; j++) {
      const o = tiers[j];
      if (sameTerms(t, o)) {
        out.push({ code: 'TIER_DUPLICATE_TERMS', severity: 'warn', field: 'name', tierId: t.id,
          message: `"${label(t)}" grants the same as "${label(o)}".`, suggestion: 'Merge the two tiers, or make one of them different.' });
        continue;
      }
      if (t.is_exclusive !== o.is_exclusive) continue;
      const [hi, lo] = effectivePrice(t) >= effectivePrice(o) ? [t, o] : [o, t];
      if (effectivePrice(hi) === effectivePrice(lo)) continue;
      if (covers(lo, hi)) {
        out.push({ code: 'TIER_NOT_ABOVE_CHEAPER', severity: 'warn', field: 'price_usd', tierId: hi.id,
          message: `"${label(hi)}" costs more than "${label(lo)}" but grants nothing extra.`, suggestion: 'Add something to the pricier tier, or lower its price.' });
      }
    }
  });
  return out;
}

function generalFindings(tiers: TierDraft[], template: string): Finding[] {
  const out: Finding[] = [];
  if (!template.trim()) return out; // empty = the default contract, which has its own fixed wording
  if (!mentionsTierTerms(template)) {
    out.push({ code: 'TEMPLATE_MISSING_TERMS', severity: 'info', field: 'template',
      message: 'Your custom contract uses none of the tier placeholders, so it will not reflect each tier’s terms.',
      suggestion: 'Insert placeholders such as {{streaming_limit}} in the License Contract, or switch to the tier-aware default.' });
  }
  if (templateHasCreditWording(template) && tiers.length > 0 && tiers.every((t) => !t.credit_required)) {
    out.push({ code: 'CREDIT_CLAUSE_UNUSED', severity: 'info', field: 'template',
      message: 'Your contract has credit wording, but no tier requires credit, so it never appears.',
      suggestion: 'Turn on Credit Required for a tier, or remove the credit clause.' });
  }
  return out;
}

// ── Entry point ─────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { risk: 0, warn: 1, info: 2 };

function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || a.code.localeCompare(b.code)
    || (a.tierId ?? '').localeCompare(b.tierId ?? ''));
}

function summarize(findings: Finding[]): AnalysisSummary {
  const n = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const risk = n('risk'), warn = n('warn'), info = n('info');
  const parts = [
    risk && `${risk} ${risk === 1 ? 'risk' : 'risks'}`,
    warn && `${warn} ${warn === 1 ? 'warning' : 'warnings'}`,
    info && `${info} ${info === 1 ? 'note' : 'notes'}`,
  ].filter(Boolean);
  return { risk, warn, info, text: parts.length ? parts.join(', ') : 'Nothing to flag' };
}

function comparisonLine(t: TierDraft): string {
  const bits = [
    t.is_free ? 'Free' : money(t.price_usd),
    t.is_exclusive ? 'exclusive' : 'non-exclusive',
    t.file_types.length ? t.file_types.join('/') : 'no files',
    `streams ${capText(t.streaming_limit)}`,
    `copies ${capText(t.distribution_limit)}`,
  ];
  if (t.stems_included) bits.push('stems');
  if (t.sync_rights === true) bits.push('sync');
  if (t.broadcast_rights === true) bits.push('broadcast');
  return bits.join(' · ');
}

/**
 * Check a set of tiers (as drafted, unsaved edits included) against each other
 * and, when given, the saved contract template. Never throws; an empty set is
 * "nothing to flag".
 */
export function analyzeLicenseTiers(input: { tiers: TierDraft[]; template?: string | null }): Analysis {
  const template = typeof input.template === 'string' ? input.template : '';
  const tiers = input.tiers;
  const perTierRaw = tiers.flatMap((t) => tierFindings(t, template));
  const all = sortFindings([...perTierRaw, ...setFindings(tiers, template), ...generalFindings(tiers, template)]);
  const perTier: Record<string, Finding[]> = {};
  for (const t of tiers) perTier[t.id] = all.filter((f) => f.tierId === t.id);
  return {
    findings: all,
    perTier,
    general: all.filter((f) => f.tierId === undefined),
    summary: summarize(all),
    comparison: tiers.map((t) => ({ id: t.id, name: label(t), line: comparisonLine(t) })),
  };
}
