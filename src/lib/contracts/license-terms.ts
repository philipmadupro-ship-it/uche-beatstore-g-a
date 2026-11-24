/**
 * Tier terms for the license-contract template (LICENSE-02).
 *
 * The License Builder stores what a tier grants (streams, distribution,
 * file types, stems, rights, credit). The contract used to hardcode the
 * same numbers in prose, so the two could disagree. This module lets a
 * template reference the purchased tier instead:
 *
 *   - value placeholders: {{streaming_limit}}, {{file_types}}, ...
 *   - clause blocks, each directive on a line of its own:
 *
 *         {{#if credit_required}}
 *         - Producer must be credited ...
 *         {{/if}}
 *
 *     `{{#unless flag}}` is the inverse; both close with `{{/if}}`.
 *
 * Everything here is pure. Clause parsing is line-based string work (no
 * regex over the template body), so a hostile or malformed template cannot
 * cause backtracking. Anything it cannot understand is left as literal text,
 * the same rule `fillTemplate` already applies to an unknown {{variable}}:
 * a typo stays visible instead of silently deleting contract wording.
 */

export interface TierTerms {
  name: string;
  file_types: string[];
  stems_included: boolean;
  is_exclusive: boolean;
  /** null = unlimited */
  streaming_limit: number | null;
  /** null = unlimited */
  distribution_limit: number | null;
  /** null = the tier does not say (legacy tiers) */
  commercial_rights: boolean | null;
  sync_rights: boolean | null;
  broadcast_rights: boolean | null;
  credit_required: boolean;
}

export interface TermsVariables {
  tier_name: string;
  file_types: string;
  stems: string;
  streaming_limit: string;
  distribution_limit: string;
  commercial_use: string;
  sync_use: string;
  broadcast_use: string;
  credit_requirement: string;
}

export const TERM_VARIABLE_LIST: Array<{ key: keyof TermsVariables; label: string; sample: string }> = [
  { key: 'tier_name',          label: 'Tier name',          sample: 'Lease' },
  { key: 'file_types',         label: 'Files delivered',    sample: 'MP3, WAV' },
  { key: 'stems',              label: 'Stems',              sample: 'Not included' },
  { key: 'streaming_limit',    label: 'Streaming limit',    sample: '100,000 streams' },
  { key: 'distribution_limit', label: 'Distribution limit', sample: 'Unlimited' },
  { key: 'commercial_use',     label: 'Commercial use',     sample: 'Permitted' },
  { key: 'sync_use',           label: 'Sync / film',        sample: 'Not permitted' },
  { key: 'broadcast_use',      label: 'Broadcast / TV',     sample: 'Not permitted' },
  { key: 'credit_requirement', label: 'Credit',             sample: 'Credit required' },
];

export type ClauseFlag =
  | 'credit_required'
  | 'stems_included'
  | 'commercial_rights'
  | 'sync_rights'
  | 'broadcast_rights'
  | 'is_exclusive';

export const CLAUSE_FLAG_LIST: Array<{ flag: ClauseFlag; label: string; starter: string }> = [
  { flag: 'credit_required',   label: 'Credit required',  starter: 'Producer must be credited as "prod. {{producer_name}}" in the work\'s metadata' },
  { flag: 'stems_included',    label: 'Stems included',   starter: 'Stems are delivered with this license' },
  { flag: 'commercial_rights', label: 'Commercial use',   starter: 'Commercial use of the work is permitted' },
  { flag: 'sync_rights',       label: 'Sync / film',      starter: 'Synchronisation in film, video and advertising is permitted' },
  { flag: 'broadcast_rights',  label: 'Broadcast / TV',   starter: 'Broadcast on television and radio is permitted' },
  { flag: 'is_exclusive',      label: 'Exclusive tier',   starter: 'The Producer will not re-sell or re-list the work after this date' },
];

const FLAG_NAMES: readonly string[] = CLAUSE_FLAG_LIST.map((f) => f.flag);

export function isClauseFlag(value: string): value is ClauseFlag {
  return FLAG_NAMES.includes(value);
}

/** Maximum clause nesting. A block opened deeper than this is left literal. */
export const MAX_CLAUSE_DEPTH = 3;

/** Every placeholder key a template may use. */
export const TERM_KEYS: readonly string[] = TERM_VARIABLE_LIST.map((v) => v.key);

// ── Building terms ──────────────────────────────────────────────────────────

/** What a purchase with no `licenses` row (legacy type string) is taken to grant. */
export function legacyTierTerms(type: 'lease' | 'exclusive'): TierTerms {
  return type === 'exclusive'
    ? {
        name: 'Exclusive', file_types: ['MP3', 'WAV', 'STEMS'], stems_included: true, is_exclusive: true,
        streaming_limit: null, distribution_limit: null,
        commercial_rights: true, sync_rights: null, broadcast_rights: null, credit_required: false,
      }
    : {
        name: 'Lease', file_types: ['MP3'], stems_included: false, is_exclusive: false,
        streaming_limit: 5000, distribution_limit: 5000,
        commercial_rights: true, sync_rights: null, broadcast_rights: null, credit_required: true,
      };
}

function limitOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/**
 * A `licenses` row (or any partial of one) as terms. Columns that are absent
 * or the wrong shape read as "not specified", never as a guess: a missing
 * column on an older database must not turn into "Not permitted" in a contract.
 */
export function tierTermsFromRow(row: Record<string, unknown>, fallbackType: 'lease' | 'exclusive' = 'lease'): TierTerms {
  const legacy = legacyTierTerms(fallbackType);
  const fileTypes = Array.isArray(row.file_types)
    ? [...new Set(row.file_types.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toUpperCase()).filter(Boolean))]
    : legacy.file_types;
  const isExclusive = typeof row.is_exclusive === 'boolean' ? row.is_exclusive : legacy.is_exclusive;
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : legacy.name;
  const hasStreaming = 'streaming_limit' in row;
  const hasDistribution = 'distribution_limit' in row;
  return {
    name,
    file_types: fileTypes,
    stems_included: typeof row.stems_included === 'boolean' ? row.stems_included : legacy.stems_included,
    is_exclusive: isExclusive,
    streaming_limit: hasStreaming ? limitOf(row.streaming_limit) : legacy.streaming_limit,
    distribution_limit: hasDistribution ? limitOf(row.distribution_limit) : legacy.distribution_limit,
    commercial_rights: boolOrNull(row.commercial_rights),
    sync_rights: boolOrNull(row.sync_rights),
    broadcast_rights: boolOrNull(row.broadcast_rights),
    credit_required: typeof row.credit_required === 'boolean' ? row.credit_required : legacy.credit_required,
  };
}

function limitText(n: number | null, unit: string): string {
  return n === null ? 'Unlimited' : `${n.toLocaleString('en-US')} ${unit}`;
}

function permitted(v: boolean | null): string {
  return v === null ? 'Not specified' : v ? 'Permitted' : 'Not permitted';
}

function termValues(t: TierTerms, producerName: string): TermsVariables {
  return {
    tier_name: t.name,
    file_types: t.file_types.length ? t.file_types.join(', ') : 'None',
    stems: t.stems_included ? 'Included' : 'Not included',
    streaming_limit: limitText(t.streaming_limit, 'streams'),
    distribution_limit: limitText(t.distribution_limit, 'copies'),
    commercial_use: permitted(t.commercial_rights),
    sync_use: permitted(t.sync_rights),
    broadcast_use: permitted(t.broadcast_rights),
    credit_requirement: t.credit_required
      ? (producerName ? `Credit required: prod. ${producerName}` : 'Credit required')
      : 'No credit required',
  };
}

/**
 * Display strings for the tiers on one purchase. A cart can hold several tiers
 * and there is one contract, so a value every tier shares is stated once and a
 * value that differs is spelled out per tier: "Lease: 5,000 streams; Exclusive: Unlimited".
 */
export function termsVariables(tiers: TierTerms[], producerName = ''): TermsVariables {
  const list = tiers.length ? tiers : [legacyTierTerms('lease')];
  const per = list.map((t) => ({ name: t.name, v: termValues(t, producerName) }));
  const out = {} as TermsVariables;
  for (const key of TERM_KEYS as Array<keyof TermsVariables>) {
    const distinct = [...new Set(per.map((p) => p.v[key]))];
    if (key === 'tier_name') {
      out[key] = distinct.join(' + ');
    } else if (distinct.length === 1) {
      out[key] = distinct[0];
    } else {
      const seen = new Set<string>();
      const parts: string[] = [];
      for (const p of per) {
        const part = `${p.name}: ${p.v[key]}`;
        if (!seen.has(part)) { seen.add(part); parts.push(part); }
      }
      out[key] = parts.join('; ');
    }
  }
  return out;
}

/** A clause shows when ANY purchased tier has the flag. Unknown (null) counts as off. */
export function termsFlags(tiers: TierTerms[]): Record<ClauseFlag, boolean> {
  const list = tiers.length ? tiers : [legacyTierTerms('lease')];
  const any = (f: (t: TierTerms) => boolean | null) => list.some((t) => f(t) === true);
  return {
    credit_required: any((t) => t.credit_required),
    stems_included: any((t) => t.stems_included),
    commercial_rights: any((t) => t.commercial_rights),
    sync_rights: any((t) => t.sync_rights),
    broadcast_rights: any((t) => t.broadcast_rights),
    is_exclusive: any((t) => t.is_exclusive),
  };
}

// ── Clause blocks ───────────────────────────────────────────────────────────

type Directive =
  | { kind: 'open'; negate: boolean; flag: string }
  | { kind: 'close' }
  | { kind: 'malformed' };

/** A line that is nothing but a directive. String work only. */
function directiveOf(line: string): Directive | null {
  const t = line.trim();
  if (!t.startsWith('{{') || !t.endsWith('}}')) return null;
  const inner = t.slice(2, -2).trim();
  if (inner === '/if') return { kind: 'close' };
  const m = inner.startsWith('#if ') ? { negate: false, rest: inner.slice(4) }
    : inner.startsWith('#unless ') ? { negate: true, rest: inner.slice(8) }
    : null;
  if (m) {
    const flag = m.rest.trim();
    return flag && !flag.includes(' ') && !flag.includes('{') && !flag.includes('}')
      ? { kind: 'open', negate: m.negate, flag }
      : { kind: 'malformed' };
  }
  // `{{#...}}` / `{{/...}}` that is not one of ours.
  if (inner.startsWith('#') || inner.startsWith('/')) return { kind: 'malformed' };
  return null;
}

type Pairing = {
  /** per line: 'literal' (kept as text), 'open', 'close', or null (ordinary line) */
  role: Array<'literal' | 'open' | 'close' | null>;
  problems: string[];
};

/** Match opens to closes with a stack. Unpaired / unknown / too-deep ones stay literal. */
function pair(lines: string[]): Pairing {
  const role: Pairing['role'] = lines.map(() => null);
  const problems: string[] = [];
  const stack: Array<{ line: number; live: boolean }> = [];
  lines.forEach((line, i) => {
    const d = directiveOf(line);
    if (!d) return;
    if (d.kind === 'malformed') { role[i] = 'literal'; problems.push(`Unrecognised clause line: ${line.trim()}`); return; }
    if (d.kind === 'open') {
      const known = isClauseFlag(d.flag);
      const liveDepth = stack.filter((s) => s.live).length;
      const live = known && liveDepth < MAX_CLAUSE_DEPTH;
      if (!known) problems.push(`Unknown clause option "${d.flag}"`);
      else if (!live) problems.push(`Clause nested deeper than ${MAX_CLAUSE_DEPTH} levels: ${line.trim()}`);
      stack.push({ line: i, live });
      role[i] = live ? 'open' : 'literal';
      return;
    }
    const top = stack.pop();
    if (!top) { role[i] = 'literal'; problems.push('A {{/if}} with no matching {{#if}}'); return; }
    role[i] = top.live ? 'close' : 'literal';
  });
  // Whatever is still on the stack was never closed: leave the open line as text.
  for (const s of stack) {
    if (role[s.line] === 'open') role[s.line] = 'literal';
    if (s.live) problems.push(`Clause never closed: ${lines[s.line].trim()}`);
  }
  // An 'open' demoted above must demote its already-assigned inner structure consistently: inner
  // blocks were paired against their own closes, so only the demoted block's own lines change.
  return { role, problems };
}

/**
 * Apply `{{#if}}` / `{{#unless}}` blocks. A template with no valid block comes
 * back byte-for-byte unchanged.
 */
export function applyClauses(template: string, flags: Record<ClauseFlag, boolean>): string {
  if (!template.includes('{{#') && !template.includes('{{/')) return template;
  const lines = template.split('\n');
  const { role } = pair(lines);
  if (!role.some((r) => r === 'open' || r === 'close')) return template;
  // A block whose open was demoted (never closed) also has no valid close: re-pair by
  // matching only 'open'/'close' roles, which are balanced by construction.
  const out: string[] = [];
  const shown: boolean[] = [];
  lines.forEach((line, i) => {
    const r = role[i];
    if (r === 'open') {
      const d = directiveOf(line) as Extract<Directive, { kind: 'open' }>;
      const v = flags[d.flag as ClauseFlag] === true;
      shown.push(d.negate ? !v : v);
      return;
    }
    if (r === 'close') { shown.pop(); return; }
    if (shown.every(Boolean)) out.push(line);
  });
  return out.join('\n');
}

// ── Lint (editor hint) ──────────────────────────────────────────────────────

/** Problems a producer would want to know about, in plain words. */
export function lintTemplate(template: string, knownKeys: readonly string[]): string[] {
  const problems: string[] = [];
  const lines = template.split('\n');
  problems.push(...pair(lines).problems);
  const seen = new Set<string>();
  for (const line of lines) {
    if (directiveOf(line)) continue;
    for (const m of line.matchAll(/\{\{([a-z_]+)\}\}/g)) {
      if (!knownKeys.includes(m[1]) && !seen.has(m[1])) {
        seen.add(m[1]);
        problems.push(`Unknown placeholder {{${m[1]}}}`);
      }
    }
  }
  return problems;
}

// ── Editor: wrap a selection in a clause ────────────────────────────────────

/**
 * Wrap the lines touched by the selection in `{{#if flag}}…{{/if}}`; with an
 * empty selection insert a starter clause on its own lines at the caret.
 * Returns the new text and where to put the caret.
 */
export function wrapInClause(
  text: string,
  selStart: number,
  selEnd: number,
  flag: ClauseFlag,
  negate = false,
): { text: string; cursor: number } {
  const open = `{{#${negate ? 'unless' : 'if'} ${flag}}}`;
  const close = '{{/if}}';
  const start = Math.max(0, Math.min(selStart, text.length));
  const end = Math.max(start, Math.min(selEnd, text.length));
  if (start === end) {
    const starter = CLAUSE_FLAG_LIST.find((f) => f.flag === flag)?.starter ?? '';
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const atLineStart = start === lineStart;
    const prefix = atLineStart ? '' : '\n';
    const block = `${prefix}${open}\n- ${starter}\n${close}\n`;
    return { text: text.slice(0, start) + block + text.slice(start), cursor: start + block.length };
  }
  const from = text.lastIndexOf('\n', start - 1) + 1;
  let to = text.indexOf('\n', end);
  if (to === -1) to = text.length;
  const body = text.slice(from, to);
  const wrapped = `${open}\n${body}\n${close}`;
  return { text: text.slice(0, from) + wrapped + text.slice(to), cursor: from + wrapped.length };
}

// ── Purchase → tiers ────────────────────────────────────────────────────────

/**
 * The tier terms for each line item of a purchase. `rows` are the full
 * `licenses` rows by id, or null when they could not be read (an older database
 * without the extra columns, a failed query): each line then falls back to what
 * the line item itself recorded at purchase, then to the legacy terms. The
 * contract is never blocked by missing tier data.
 */
export function tiersForLineItems(
  items: Array<{
    license_id: string;
    license_type: 'lease' | 'exclusive';
    file_types?: string[];
    stems_included?: boolean;
    is_exclusive?: boolean;
  }>,
  rows: Map<string, Record<string, unknown>> | null,
): TierTerms[] {
  return items.map((li) => {
    const row = rows?.get(li.license_id);
    if (row) return tierTermsFromRow(row, li.license_type);
    const legacy = legacyTierTerms(li.license_type);
    return {
      ...legacy,
      file_types: li.file_types?.length ? li.file_types : legacy.file_types,
      stems_included: li.stems_included ?? legacy.stems_included,
      is_exclusive: li.is_exclusive ?? legacy.is_exclusive,
    };
  });
}
