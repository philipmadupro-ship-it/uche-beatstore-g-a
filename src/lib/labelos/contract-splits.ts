/**
 * Contract ↔ split sheets (LABEL-59, doc 23 §D). Pure.
 *
 * A contract that states a master or publishing share (`master_share` /
 * `publishing_share` merge fields, LABEL-57) can start the split sheet that
 * records it, and a sheet that is already in force can be checked against the
 * contract it came from. Three things live here, none of them stored:
 *
 *   1. PREFILL  `planPrefill` — the lines a contract implies, per sheet kind.
 *      The caller writes them as a DRAFT only (it never touches a circulated
 *      or signed sheet) and refuses to overwrite an existing draft unless the
 *      person said so (`planDraftWrite`).
 *   2. DRIFT    `deriveDrift` — a live (circulated | signed) sheet that
 *      disagrees with a sent or signed contract. Derived on every read from the
 *      two documents, so it can never be stale; nothing is written.
 *   3. SIGNING  `canSignContract` — the `require_signed_master_split` rule, for
 *      LABEL-60's sign route to call (`contract-splits-store#assertCanSign`).
 *
 * WHICH CONTRACTS APPLY is decided by the template data, not by taste: a type
 * applies when its platform template asks for `master_share` or
 * `publishing_share` (`CONTRACT_SPLIT_RULES` is pinned to the templates by a
 * test). Today: producer agreement, beat licence, feature, co-publishing and
 * collaboration. A recording agreement, a 360 or a distribution deal states
 * royalty rates, not a split of one song, so it does not prefill a sheet.
 *
 * SHARES ARE INTEGER UNITS (0.0001 %), the maths of `splits.ts`. A field is
 * parsed with `parseShare` (digit by digit), summed in integers and spread with
 * a largest-remainder rule: nothing here touches a float, and 33.3333 × 3 is
 * still 99.9999, which the sheet then refuses to circulate.
 *
 * D2: a drift view for a reader without `rights.read` carries no name, share or
 * total, only that the sheet differs from its contract.
 */
import type { PartyRole, TemplateTypeId } from './contracts/types';
import { FULL_SHARE, draftIssues, formatShare, parseShare, type SplitKind, type SplitLineInput, type SplitRole } from './splits';

export type ShareField = 'master_share' | 'publishing_share';

export type ContractSplitRule = {
  kind: SplitKind;
  /** The merge field holding the stated share. */
  field: ShareField;
  /** Parties in these roles each hold the stated share. */
  holders: readonly PartyRole[];
  /** The sheet role their line gets. */
  holderRole: SplitRole;
  /** A blank field means "equal shares among the holders" (collaboration). */
  evenWhenBlank?: boolean;
  /** Who takes the rest. One party takes it all; several share it equally. */
  remainder?: { roles: readonly PartyRole[]; role: SplitRole };
};

/** Per contract type, in sheet-kind order. A type missing here prefills nothing. */
export const CONTRACT_SPLIT_RULES: Readonly<Partial<Record<TemplateTypeId, readonly ContractSplitRule[]>>> = {
  producer: [{ kind: 'composition', field: 'publishing_share', holders: ['producer'], holderRole: 'writer' }],
  beat_licence: [{ kind: 'composition', field: 'publishing_share', holders: ['licensor'], holderRole: 'writer' }],
  feature: [
    { kind: 'master', field: 'master_share', holders: ['featured'], holderRole: 'master_owner', remainder: { roles: ['artist'], role: 'master_owner' } },
    { kind: 'composition', field: 'publishing_share', holders: ['featured'], holderRole: 'writer', remainder: { roles: ['artist'], role: 'writer' } },
  ],
  co_publishing: [
    { kind: 'composition', field: 'publishing_share', holders: ['publisher'], holderRole: 'publisher', remainder: { roles: ['collaborator'], role: 'writer' } },
  ],
  collaboration: [
    { kind: 'master', field: 'master_share', holders: ['collaborator'], holderRole: 'master_owner', evenWhenBlank: true },
    { kind: 'composition', field: 'publishing_share', holders: ['collaborator'], holderRole: 'writer', evenWhenBlank: true },
  ],
};

export function rulesFor(type: TemplateTypeId): readonly ContractSplitRule[] {
  return CONTRACT_SPLIT_RULES[type] ?? [];
}

export function ruleFor(type: TemplateTypeId, kind: SplitKind): ContractSplitRule | null {
  return rulesFor(type).find((r) => r.kind === kind) ?? null;
}

/** Does a contract of this type pre-fill (and get checked against) a split sheet? */
export const isSplitContractType = (type: TemplateTypeId): boolean => rulesFor(type).length > 0;

/** The contract statuses a sheet is compared with: a draft contract is still being written. */
export const DRIFT_CONTRACT_STATUSES: readonly string[] = ['sent', 'signed'];

export type ContractFacts = {
  type: TemplateTypeId;
  status: string;
  trackId: string | null;
  fields: Readonly<Record<string, string>>;
  /** Parties in position order. */
  parties: readonly { partyId: string; role: PartyRole }[];
};

// ── Prefill ──────────────────────────────────────────────────────────────

export type ExpectedLine = {
  partyId: string;
  role: SplitRole;
  units: number;
  /**
   * `true` when the contract states this number (or it follows by subtraction
   * from one it states). An equal division the contract did not state is
   * `false`: it is offered in the draft, but a sheet that divides differently
   * is not "drift".
   */
  firm: boolean;
};

export type SkipReason =
  | 'no_song'
  | 'field_missing'
  | 'no_holder'
  | 'over_100'
  | 'invalid';

export const SKIP_MESSAGE: Readonly<Record<SkipReason, string>> = {
  no_song: 'Link the contract to a song first.',
  field_missing: 'The contract does not state the share yet.',
  no_holder: 'The contract has no party in the role that holds the share.',
  over_100: 'The shares the contract states add up to more than 100%.',
  invalid: 'The contract’s shares cannot be written as a split sheet.',
};

export type KindPlan =
  | { kind: SplitKind; ok: true; lines: ExpectedLine[]; incomplete: boolean }
  | { kind: SplitKind; ok: false; reason: SkipReason };

/** Spread `total` units over `n` lines; the leftover units go one each to the first lines. */
export function spreadUnits(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(total) || total < 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

const partiesIn = (c: Pick<ContractFacts, 'parties'>, roles: readonly PartyRole[]): string[] => {
  const seen = new Set<string>();
  for (const p of c.parties) if (roles.includes(p.role)) seen.add(p.partyId);
  return [...seen];
};

/** What one rule asks of a contract. */
export function expectedForRule(contract: ContractFacts, rule: ContractSplitRule): KindPlan {
  const fail = (reason: SkipReason): KindPlan => ({ kind: rule.kind, ok: false, reason });
  if (!contract.trackId) return fail('no_song');
  const holders = partiesIn(contract, rule.holders);
  if (holders.length === 0) return fail('no_holder');

  const raw = (contract.fields[rule.field] ?? '').trim();
  let each: number[];
  let firm = true;
  if (raw === '') {
    if (!rule.evenWhenBlank) return fail('field_missing');
    each = spreadUnits(FULL_SHARE, holders.length);
    firm = false;
  } else {
    const units = parseShare(raw);
    if (units === null || units <= 0) return fail('invalid');
    each = holders.map(() => units);
  }
  const held = each.reduce((a, b) => a + b, 0);
  if (held > FULL_SHARE) return fail('over_100');

  const lines: ExpectedLine[] = holders.map((partyId, i) => ({ partyId, role: rule.holderRole, units: each[i], firm }));
  const left = FULL_SHARE - held;
  if (rule.remainder && left > 0) {
    // A party that already holds a line keeps just that one: the same person cannot take the remainder too.
    const takers = partiesIn(contract, rule.remainder.roles).filter((id) => !holders.includes(id));
    if (takers.length === 1) lines.push({ partyId: takers[0], role: rule.remainder.role, units: left, firm });
    else if (takers.length > 1) {
      const parts = spreadUnits(left, takers.length);
      takers.forEach((partyId, i) => lines.push({ partyId, role: rule.remainder!.role, units: parts[i], firm: false }));
    }
  }

  const asInput: SplitLineInput[] = lines.map((l) => ({ partyId: l.partyId, role: l.role, units: l.units }));
  if (draftIssues(rule.kind, asInput).length > 0) return fail('invalid');
  return { kind: rule.kind, ok: true, lines, incomplete: lines.reduce((a, l) => a + l.units, 0) !== FULL_SHARE };
}

/** One plan per sheet kind the contract's type has a rule for. */
export function planPrefill(contract: ContractFacts): KindPlan[] {
  return rulesFor(contract.type).map((rule) => expectedForRule(contract, rule));
}

export type ExistingSheet = { kind: string; status: string };

export type DraftWriteDecision =
  /** No draft yet: start one with these lines. */
  | { action: 'create' }
  /** A draft exists and the person said to replace its lines. */
  | { action: 'replace' }
  /** A draft exists: ask, never overwrite silently. */
  | { action: 'refuse'; reason: 'draft_exists' };

/**
 * A prefill only ever writes a DRAFT. With a draft already there it refuses
 * (409 to the caller) unless `replaceDraft` was sent, so a producer's
 * hand-edited lines are never lost to a button press. A circulated or signed
 * sheet is not consulted: it stays in force until the new draft is circulated.
 */
export function planDraftWrite(sheets: readonly ExistingSheet[], kind: SplitKind, replaceDraft: boolean): DraftWriteDecision {
  const hasDraft = sheets.some((s) => s.kind === kind && s.status === 'draft');
  if (!hasDraft) return { action: 'create' };
  return replaceDraft ? { action: 'replace' } : { action: 'refuse', reason: 'draft_exists' };
}

// ── Drift ────────────────────────────────────────────────────────────────

export type SheetFacts = {
  kind: string;
  status: string;
  lines: readonly { partyId: string; units: number }[];
};

export type DriftItem = {
  partyId: string;
  code: 'missing' | 'differs';
  /** Units the contract states. */
  expected: number;
  /** Units on the sheet; null when the party is not on it. */
  actual: number | null;
};

export type DriftResult = {
  kind: SplitKind;
  /** The sheet and contract were comparable. `false` = nothing to say either way. */
  checked: boolean;
  items: DriftItem[];
};

const isLive = (status: string) => status === 'circulated' || status === 'signed' || status === 'disputed';

/**
 * Compare one live sheet with its contract. Only what the contract STATES is
 * compared: each party it names with a share must be on the sheet with that
 * share (summed over the party's lines of that kind). A sheet may have more
 * people on it than the contract names, and an equal division the contract did
 * not state is not checked. A draft contract, a draft or superseded sheet, a
 * sheet of another song or a contract the rule cannot read gives `checked:
 * false`.
 */
export function deriveDrift(contract: ContractFacts, sheet: SheetFacts): DriftResult | null {
  if (!isSplitKindName(sheet.kind)) return null;
  const rule = ruleFor(contract.type, sheet.kind);
  if (!rule) return null;
  const none: DriftResult = { kind: sheet.kind, checked: false, items: [] };
  if (!DRIFT_CONTRACT_STATUSES.includes(contract.status) || !isLive(sheet.status)) return none;
  const plan = expectedForRule(contract, rule);
  if (!plan.ok) return none;

  const items: DriftItem[] = [];
  for (const exp of plan.lines) {
    if (!exp.firm) continue;
    const mine = sheet.lines.filter((l) => l.partyId === exp.partyId);
    if (mine.length === 0) items.push({ partyId: exp.partyId, code: 'missing', expected: exp.units, actual: null });
    else {
      const actual = mine.reduce((a, l) => a + l.units, 0);
      if (actual !== exp.units) items.push({ partyId: exp.partyId, code: 'differs', expected: exp.units, actual });
    }
  }
  return { kind: sheet.kind, checked: true, items };
}

function isSplitKindName(v: string): v is SplitKind {
  return v === 'composition' || v === 'master';
}

export const hasDrift = (d: DriftResult | null): boolean => !!d && d.checked && d.items.length > 0;

export type DriftView = {
  kind: SplitKind;
  drifted: boolean;
  /** `rights.read` only: who, and the two numbers. Absent for anyone else (D2). */
  items?: { partyId: string; name: string; code: DriftItem['code']; contract: string; sheet: string | null }[];
};

/** A generic view (a boolean) or, for `rights.read`, the itemised one. Built field by field. */
export function driftView(d: DriftResult, detail: boolean, nameOf: (partyId: string) => string): DriftView {
  const drifted = d.checked && d.items.length > 0;
  const view: DriftView = { kind: d.kind, drifted };
  if (detail && drifted) {
    view.items = d.items.map((i) => ({
      partyId: i.partyId,
      name: nameOf(i.partyId),
      code: i.code,
      contract: formatShare(i.expected),
      sheet: i.actual === null ? null : formatShare(i.actual),
    }));
  }
  return view;
}

// ── Signing (LABEL-60 calls this) ────────────────────────────────────────

export type SigningCheck =
  | { ok: true }
  | { ok: false; code: 'master_split_not_signed'; error: string };

/**
 * `require_signed_master_split`. When it is on, a contract that states a master
 * share for a song (a feature or collaboration with a song linked) cannot be
 * signed until that song's master sheet is `signed`. Off, or a contract that
 * has no master rule or no song, is never blocked. Disputed, circulated and
 * draft sheets do not count; the message says which stage the sheet is at so
 * the person knows the next step.
 *
 * LABEL-60's sign route must call `assertCanSign` (contract-splits-store) before
 * it moves a contract from `sent` to `signed`.
 */
export function canSignContract(input: {
  requireSignedMasterSplit: boolean;
  contract: Pick<ContractFacts, 'type' | 'trackId'>;
  /** The song's master sheets, every version. */
  masterSheets: readonly { status: string }[];
}): SigningCheck {
  if (!input.requireSignedMasterSplit) return { ok: true };
  if (!input.contract.trackId || !ruleFor(input.contract.type, 'master')) return { ok: true };
  const sheets = input.masterSheets;
  if (sheets.some((s) => s.status === 'signed')) return { ok: true };
  const stage = sheets.some((s) => s.status === 'circulated' || s.status === 'disputed')
    ? 'The master split sheet for this song has not been signed by everyone yet.'
    : sheets.some((s) => s.status === 'draft')
      ? 'The master split sheet for this song is still a draft. Circulate it and collect the signatures.'
      : 'This song has no master split sheet yet.';
  return {
    ok: false,
    code: 'master_split_not_signed',
    error: `${stage} This organization requires a signed master split before a contract is signed.`,
  };
}
