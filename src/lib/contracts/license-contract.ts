/**
 * Terms → contract text, in one place (LICENSE-04).
 *
 * `buildLicenseContract` is what BOTH the Stripe webhook and the editor
 * preview call, so what a producer previews is what a buyer gets. It takes
 * tiers that have already been validated (`resolveContractTiers`), fills the
 * producer's template, then appends a generated "Schedule of Terms" built only
 * from those tiers, which states that it governs. `verifyContractTerms` is the
 * pure compare: does the text state each selected term, and does the
 * producer's own prose contradict one.
 *
 * Pure: no I/O, no clock (the caller passes the purchase variables).
 */
import {
  SAMPLE_VARIABLES, TIER_AWARE_TEMPLATE_MD, fillTemplate, type ContractVariables,
} from './license-template';
import {
  legacyTierTerms, termsFlags, termsVariables, type TierTerms,
} from './license-terms';
import { TERMS_SNAPSHOT_VERSION, parseTierTerms } from './license-terms-snapshot';

export type TermsSource = 'snapshot' | 'licenses-row' | 'legacy' | 'fallback' | 'preview';
export interface ResolvedTier { terms: TierTerms; source: TermsSource; issues: string[] }

export const SCHEDULE_HEADING = '## Schedule of Terms';
export const SCHEDULE_GOVERNS =
  'This schedule states the exact terms of the license(s) purchased. Where this schedule and any other wording in this document differ, this schedule governs.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LineLike = {
  license_id: string;
  license_type: 'lease' | 'exclusive';
  file_types?: string[];
  stems_included?: boolean;
  is_exclusive?: boolean;
  terms?: TierTerms;
};

/** A `licenses` row read as terms: absent keys take the legacy value, PRESENT keys must be valid. */
function termsFromRowStrict(row: Record<string, unknown>, type: 'lease' | 'exclusive') {
  const legacy = legacyTierTerms(type);
  const keys = Object.keys(legacy) as Array<keyof TierTerms>;
  const candidate: Record<string, unknown> = { ...legacy };
  for (const k of keys) if (row[k] !== undefined) candidate[k] = row[k];
  return parseTierTerms(candidate);
}

/**
 * One validated tier per line item. Order of trust: terms stored on the line at
 * purchase, the live tier row, then (flagged) what the line recorded. A legacy
 * id ("lease"/"exclusive") is the legacy terms by definition and is not a problem.
 */
export function resolveContractTiers(
  lines: LineLike[],
  rows: Map<string, Record<string, unknown>> | null,
): ResolvedTier[] {
  return lines.map((li) => {
    if (li.terms !== undefined) {
      const p = parseTierTerms(li.terms);
      if (p.ok) return { terms: p.terms, source: 'snapshot' as const, issues: [] };
    }
    const legacy = legacyTierTerms(li.license_type);
    if (!UUID_RE.test(li.license_id)) return { terms: legacy, source: 'legacy' as const, issues: [] };
    const row = rows?.get(li.license_id);
    const issues: string[] = [];
    if (row) {
      const p = termsFromRowStrict(row, li.license_type);
      if (p.ok) return { terms: p.terms, source: 'licenses-row' as const, issues: [] };
      issues.push(...p.issues);
    } else {
      issues.push('tier row could not be read');
    }
    const recorded = parseTierTerms({
      ...legacy,
      file_types: li.file_types?.length ? li.file_types : legacy.file_types,
      stems_included: li.stems_included ?? legacy.stems_included,
      is_exclusive: li.is_exclusive ?? legacy.is_exclusive,
    });
    return { terms: recorded.ok ? recorded.terms : legacy, source: 'fallback' as const, issues };
  });
}

// ── Schedule ────────────────────────────────────────────────────────────────

const permitted = (v: boolean | null) => (v === null ? 'Not specified' : v ? 'Permitted' : 'Not permitted');
const limitText = (n: number | null, unit: string) => (n === null ? 'Unlimited' : `${n.toLocaleString('en-US')} ${unit}`);

/** The exact lines a tier's block must contain. The verifier reads the same list. */
export function scheduleLines(t: TierTerms, producerName: string): string[] {
  return [
    `- License: ${t.name} (${t.is_exclusive ? 'Exclusive' : 'Non-exclusive'})`,
    `- Files delivered: ${t.file_types.length ? t.file_types.join(', ') : 'None'}`,
    `- Stems: ${t.stems_included ? 'Included' : 'Not included'}`,
    `- Audio streams: ${limitText(t.streaming_limit, 'streams')}`,
    `- Downloads / physical units: ${limitText(t.distribution_limit, 'copies')}`,
    `- Commercial use: ${permitted(t.commercial_rights)}`,
    `- Sync / film: ${permitted(t.sync_rights)}`,
    `- Broadcast / TV: ${permitted(t.broadcast_rights)}`,
    `- Credit: ${t.credit_required ? (producerName ? `prod. ${producerName}` : 'Required') : 'Not required'}`,
    `- Exclusivity: ${t.is_exclusive ? 'The Producer will not re-sell or re-list the work after the purchase date' : 'Non-exclusive; the Producer may license the work to others'}`,
  ];
}

function distinctTiers(tiers: ResolvedTier[]): ResolvedTier[] {
  const seen = new Set<string>();
  return tiers.filter((t) => {
    const k = JSON.stringify(t.terms);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function scheduleOfTerms(tiers: ResolvedTier[], producerName: string): string {
  const blocks = distinctTiers(tiers).map((t) => {
    const note = t.source === 'fallback'
      ? ['The standard terms for this license type are shown because this tier\'s own terms could not be confirmed at purchase.']
      : [];
    return [`### ${t.terms.name}`, ...scheduleLines(t.terms, producerName), ...note].join('\n');
  });
  return [SCHEDULE_HEADING, '', SCHEDULE_GOVERNS, '', ...blocks.flatMap((b) => [b, ''])].join('\n').trimEnd() + '\n';
}

// ── Verify ──────────────────────────────────────────────────────────────────

/** Where the generated schedule starts: the LAST line that is exactly its heading (never a mention of it inside prose). */
export function scheduleStart(text: string): number {
  const marker = `\n${SCHEDULE_HEADING}\n`;
  const i = text.lastIndexOf(marker);
  if (i !== -1) return i + 1;
  return text.startsWith(`${SCHEDULE_HEADING}\n`) || text === SCHEDULE_HEADING ? 0 : -1;
}

export interface Verification { ok: boolean; missing: string[]; contradicted: string[] }

const NUM_STREAMS = /(\d[\d,]*)\s+(?:audio\s+)?streams/i;
const NUM_COPIES = /(\d[\d,]*)\s+(?:digital\s+)?(?:downloads|copies|units)/i;

function numIn(line: string, re: RegExp): number | null {
  const m = re.exec(line.slice(0, 2000));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare text with the selected terms.
 * - missing: a tier's schedule block does not contain one of its exact lines.
 * - contradicted: a line states a stream/copy count, delivered file type, stems
 *   promise or exclusivity promise that NO selected tier has.
 * It scans the text outside the schedule for contradictions, so the
 * producer's own prose is what gets judged. Wording heuristics: it warns, never rewrites.
 */
export function verifyContractTerms(text: string, tiers: ResolvedTier[], producerName: string): Verification {
  const terms = distinctTiers(tiers).map((t) => t.terms);
  const at = scheduleStart(text);
  const body = at === -1 ? text : text.slice(0, at);
  const schedule = at === -1 ? '' : text.slice(at);
  const missing: string[] = [];
  if (at === -1) missing.push('Schedule of Terms');
  for (const t of terms) {
    const start = schedule.indexOf(`### ${t.name}\n`);
    const next = start === -1 ? -1 : schedule.indexOf('\n### ', start + 1);
    const block = start === -1 ? '' : schedule.slice(start, next === -1 ? undefined : next);
    if (start === -1) missing.push(`${t.name}: tier block`);
    for (const l of scheduleLines(t, producerName)) if (!block.includes(l)) missing.push(`${t.name}: ${l.slice(2)}`);
  }
  const streams = new Set(terms.map((t) => t.streaming_limit).filter((n): n is number => n !== null));
  const copies = new Set(terms.map((t) => t.distribution_limit).filter((n): n is number => n !== null));
  const types = new Set(terms.flatMap((t) => t.file_types));
  const anyStems = terms.some((t) => t.stems_included);
  const anyExclusive = terms.some((t) => t.is_exclusive);
  const contradicted: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.slice(0, 2000);
    const s = numIn(line, NUM_STREAMS);
    if (s !== null && !streams.has(s)) contradicted.push(`states ${s.toLocaleString('en-US')} streams: "${line.trim()}"`);
    const c = numIn(line, NUM_COPIES);
    if (c !== null && !copies.has(c)) contradicted.push(`states ${c.toLocaleString('en-US')} downloads/copies: "${line.trim()}"`);
    if (/\b(deliver|include|provided)/i.test(line) && !/\bnot\b/i.test(line)) {
      for (const f of ['WAV', 'MP3', 'FLAC', 'AIFF', 'MIDI']) {
        if (new RegExp(`\\b${f}\\b`).test(line) && !types.has(f)) contradicted.push(`promises ${f} delivery: "${line.trim()}"`);
      }
      if (!anyStems && /\bstems\b/i.test(line)) contradicted.push(`promises stems: "${line.trim()}"`);
    }
    if (!anyExclusive && /will not re-sell or re-list/i.test(line)) contradicted.push(`promises exclusivity: "${line.trim()}"`);
  }
  return { ok: missing.length === 0 && contradicted.length === 0, missing, contradicted };
}

// ── Locked section ──────────────────────────────────────────────────────────

/** The heading level and text of a markdown heading line, or null. String work only. */
function headingOf(line: string): { level: number; text: string } | null {
  const t = line.trim();
  let n = 0;
  while (n < t.length && t[n] === '#') n += 1;
  if (n === 0 || n > 6 || t[n] !== ' ') return null;
  return { level: n, text: t.slice(n + 1).trim() };
}

const isScheduleHeading = (line: string) => headingOf(line)?.text.toLowerCase() === 'schedule of terms';

/** True when the text has a "Schedule of Terms" heading of any level: that section is generated, never written. */
export function hasScheduleSection(text: string): boolean {
  return text.split('\n').some(isScheduleHeading);
}

/**
 * Remove every "Schedule of Terms" section (its heading through the line before
 * the next heading of the same or a higher level, or the end). A producer who
 * pastes a generated contract back into the template, or a buyer-controlled
 * value that carries a heading, can then never add a second schedule beside
 * the generated one.
 */
export function stripScheduleSection(text: string): { text: string; removed: boolean } {
  const lines = text.split('\n');
  const out: string[] = [];
  let removed = false;
  let level = 0; // > 0 while inside a schedule section
  for (const line of lines) {
    const h = headingOf(line);
    if (level > 0) {
      if (h && h.level <= level && !isScheduleHeading(line)) level = 0;
      else if (!(h && isScheduleHeading(line))) continue;
    }
    if (h && isScheduleHeading(line)) { level = Math.min(h.level, 2); removed = true; continue; }
    out.push(line);
  }
  return { text: out.join('\n'), removed };
}

/** A purchase value as one plain line: a buyer-supplied name must not be able to start a heading or a clause. */
function oneLine(v: string): string {
  return String(v ?? '').replace(/\s*[\r\n]+\s*/g, ' ').slice(0, 2000);
}

/** What the producer is told when wording carries the generated section: the save refuses it. */
export const SCHEDULE_HEADING_ERROR =
  'License contract not saved: delete the line "## Schedule of Terms" and everything under it. That section is generated for every contract and cannot be part of your wording.';

export const SCHEDULE_REMOVED_NOTE =
  'A "Schedule of Terms" section in your wording was removed: the generated schedule is added to every contract and cannot be edited.';

// ── Build ───────────────────────────────────────────────────────────────────

export interface ContractSnapshot {
  v: number;
  template_source: 'producer' | 'tier-aware';
  /** the exact template text used (the caller hashes it: this module stays browser-safe) */
  template_used: string;
  tiers: Array<{ source: TermsSource; terms: TierTerms }>;
}

export interface BuiltContract {
  text: string;
  /** the generated Schedule of Terms: the text from its heading to the end of `text`, never editable */
  schedule: string;
  snapshot: ContractSnapshot;
  /** the generated text against the terms: must always be ok */
  verification: Verification;
  /** the producer's own wording against the terms: contradictions here are warnings */
  bodyConflicts: string[];
  /** anything a producer should hear about (fallback tiers, conflicting prose, a failed verification) */
  alerts: string[];
}

export function buildLicenseContract(params: {
  /** license_template_md as stored; blank = the tier-aware default */
  template: string | null | undefined;
  vars: ContractVariables;
  tiers: ResolvedTier[];
}): BuiltContract {
  const vars = Object.fromEntries(
    Object.entries(params.vars).map(([k, v]) => [k, oneLine(v as string)]),
  ) as unknown as ContractVariables;
  const tiers = params.tiers.length ? params.tiers : [{ terms: legacyTierTerms('lease'), source: 'legacy' as const, issues: [] }];
  const custom = (params.template ?? '').trim();
  const template = custom || TIER_AWARE_TEMPLATE_MD;
  const terms = tiers.map((t) => t.terms);
  const filled = fillTemplate(template, { ...vars, ...termsVariables(terms, vars.producer_name) }, termsFlags(terms));
  // The filled text (after clauses and placeholders) is what is stripped, so no template trick
  // and no purchase value can leave a second schedule in the body.
  const stripped = stripScheduleSection(filled);
  const schedule = scheduleOfTerms(tiers, vars.producer_name);
  const text = `${stripped.text.trimEnd()}\n\n${schedule}`;
  const verification = verifyContractTerms(text, tiers, vars.producer_name);
  const alerts: string[] = [];
  if (stripped.removed) alerts.push(SCHEDULE_REMOVED_NOTE);
  for (const t of tiers) if (t.source === 'fallback') alerts.push(`Tier "${t.terms.name}": ${t.issues.join('; ') || 'terms unconfirmed'} (standard terms were used)`);
  if (verification.missing.length) alerts.push(`The generated contract does not state: ${verification.missing.join('; ')}`);
  for (const c of verification.contradicted) alerts.push(`Your template wording ${c}`);
  return {
    text,
    schedule,
    verification,
    bodyConflicts: verification.contradicted,
    alerts,
    snapshot: {
      v: TERMS_SNAPSHOT_VERSION,
      template_source: custom ? 'producer' : 'tier-aware',
      template_used: template,
      tiers: tiers.map((t) => ({ source: t.source, terms: t.terms })),
    },
  };
}

/**
 * What a buyer of `tiers` would receive, with sample purchase details. The
 * editor preview: the same build as the webhook, so nothing differs but the
 * sample names. Tiers here are the producer's own, taken as validated.
 */
/** A purchase date the way the webhook writes it: the day the contract is made. */
export function purchaseDateLabel(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function previewContract(template: string, tiers: TierTerms[], now: Date = new Date()): BuiltContract {
  const list = tiers.length ? tiers : [legacyTierTerms('lease')];
  return buildLicenseContract({
    template,
    vars: { ...SAMPLE_VARIABLES, purchase_date: purchaseDateLabel(now), license_type: list.some((t) => t.is_exclusive) ? 'Exclusive' : 'Lease' },
    tiers: list.map((terms) => ({ terms, source: 'preview' as const, issues: [] })),
  });
}

export function previewTemplate(template: string, tiers: TierTerms[]): string {
  return previewContract(template, tiers).text;
}
