/**
 * Matching, allocation, contract rates and recoupment for imported earnings
 * (LABEL-62). Pure: facts in, rows out; the store loads the facts and writes
 * the rows. Money is integer minor units (`bigint`) through `money.ts` only —
 * no float, no `numeric` in JS.
 *
 * ── MATCHING ──────────────────────────────────────────────────────────────
 * A line is matched to a RECORDING by ISRC first, then by UPC (a release's
 * barcode → its masters). Exactly one candidate matches; two or more is
 * `ambiguous_match` (a UPC of an album names several recordings: add ISRCs).
 * The recording is then mapped to its SONG (a song is its own recording; a
 * master is a release item's master or linked to a song as its `master`):
 * the splits live on the song. Nothing is ever guessed: no identifier,
 * no match, no song → the line waits in the needs-review queue with a reason.
 *
 * ── ALLOCATION AND CONTRACT TERMS ─────────────────────────────────────────
 * ORCHESTRATOR DECISION (2026-11-02), OWNER MAY CHANGE. A line's gross is paid
 * out per payee on ONE of two bases, never both (an artist with 50 % of the
 * master and a 20 % royalty must not get 10 %):
 *
 *  - RATE: the payee has a SIGNED contract (status `signed`; the database only
 *    gets there with every signature valid for the frozen document, and the
 *    store re-checks it) that covers the payee AND the song and states a
 *    `royalty_rate`, in term for the line's period. payable = gross × rate,
 *    rounded HALF TO EVEN (the one place a rate is applied). The split sheet is
 *    NOT applied to that payee. "Covers the song": the contract is for this song,
 *    or for a release that contains it (a payee need not be on the sheet), or it
 *    is an artist-level deal (no song, no release) and the contract's artist is
 *    the SONG's artist (inbox or linked contact of a project the song sits in) —
 *    a feature on someone else's song keeps their split share. Most specific
 *    level wins (song > release > artist); two contracts at the best level with
 *    DIFFERENT rates → `contract_ambiguous` (never a guess); equal rates → the
 *    lowest contract id.
 *    INCOME CLASS: a rate applies only to lines of the class its contract type
 *    carries (`rateIncomeClass`): recording, feature, producer, beat licence,
 *    distribution and 360 → `master` income; co-writing / co-publishing →
 *    `publishing` income; every other type (licence, management, NDA, …) sets no
 *    rate at all. A master rate never touches a publishing line, where that
 *    payee keeps their composition share.
 *  - SPLIT: every other payee on the song's sheet in force gets gross × their
 *    share. The sheet is the song's CURRENT one (circulated / signed / disputed;
 *    `isLive`) of the line's income class (`master` income → MASTER sheet,
 *    `publishing` → COMPOSITION sheet): exactly one must exist and add to
 *    100 % (units: 100 % = 1 000 000). A party on two rows is one party. The
 *    split amounts use largest-remainder over the whole sheet (`allocate`, ties
 *    to the earlier row), so they sum to the gross exactly when nobody is on a
 *    rate.
 *
 * If the RATE payees plus the SPLIT payees come to more than 100 % of the line
 * (units, exactly; and in minor units as a guard), NOTHING is paid for the line:
 * it waits in the review queue as `terms_exceed_gross` — never pay more than was
 * received. Whatever is left is RETAINED by the label (gross − Σ payable;
 * derived, never paid). A line is allocated whole or not at all: any payee with
 * no payee record, an inactive one, or one paid in another currency than the
 * file (no conversion) sends the WHOLE line to review.
 *
 * ── RECOUPMENT ────────────────────────────────────────────────────────────
 * Per payee, in a documented order: allocations by (line number, sheet row);
 * advances oldest first (created_at, then id). Only RECOUPABLE, non-void
 * advances are recouped, only from POSITIVE payable amounts (a negative line
 * — a clawback — is not recouped and does not un-recoup), each take is
 * min(advance remaining, payable left), so no advance goes below zero and no
 * payable goes below zero. `net = payable − recouped ≥ 0` for every
 * allocation of a positive line.
 */
import { isLive, FULL_SHARE, sumShares } from '../splits';
import { allocate, applyShare, money, type Money } from './money';
import type { IncomeClass, ParsedLine } from './earnings-import';

export const REVIEW_REASONS = [
  'no_identifier', 'no_match', 'ambiguous_match', 'no_song', 'no_sheet', 'bad_split',
  'no_payee', 'payee_inactive', 'currency_mismatch', 'contract_ambiguous', 'terms_exceed_gross',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REVIEW_REASON_LABEL: Readonly<Record<ReviewReason, string>> = {
  no_identifier: 'No readable ISRC or UPC on the line',
  no_match: 'No recording with this ISRC or UPC',
  ambiguous_match: 'More than one recording or song matches',
  no_song: 'The recording is not linked to a song',
  no_sheet: 'The song has no split sheet in force for this income',
  bad_split: 'The split sheet does not add up to 100 %',
  no_payee: 'Someone on the split has no payee yet',
  payee_inactive: 'A payee on the split is inactive',
  currency_mismatch: 'A payee is paid in another currency than this file (no conversion)',
  contract_ambiguous: 'Two signed contracts give different rates',
  terms_exceed_gross: 'The contract rates and splits add up to more than the line',
};

export const isReviewReason = (v: unknown): v is ReviewReason => typeof v === 'string' && (REVIEW_REASONS as readonly string[]).includes(v);

// ── Matching ─────────────────────────────────────────────────────────────

export type MatchFacts = {
  recordingsByIsrc: ReadonlyMap<string, readonly string[]>;
  recordingsByUpc: ReadonlyMap<string, readonly string[]>;
  /** recording id → the song(s) it belongs to (a song maps to itself). */
  songsOf: ReadonlyMap<string, readonly string[]>;
};

export type Match = { ok: true; trackId: string; songId: string } | { ok: false; reason: ReviewReason; trackId: string | null; songId: string | null };

const distinct = (xs: readonly string[] | undefined): string[] => [...new Set(xs ?? [])].sort();

export function matchLine(line: Pick<ParsedLine, 'isrc' | 'upc'>, facts: MatchFacts): Match {
  if (!line.isrc && !line.upc) return { ok: false, reason: 'no_identifier', trackId: null, songId: null };
  let candidates = line.isrc ? distinct(facts.recordingsByIsrc.get(line.isrc)) : [];
  if (candidates.length === 0 && line.upc) candidates = distinct(facts.recordingsByUpc.get(line.upc));
  if (candidates.length === 0) return { ok: false, reason: 'no_match', trackId: null, songId: null };
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous_match', trackId: null, songId: null };
  const trackId = candidates[0];
  const songs = distinct(facts.songsOf.get(trackId));
  if (songs.length === 0) return { ok: false, reason: 'no_song', trackId, songId: null };
  if (songs.length > 1) return { ok: false, reason: 'ambiguous_match', trackId, songId: null };
  return { ok: true, trackId, songId: songs[0] };
}

// ── Allocation ───────────────────────────────────────────────────────────

export type SheetKind = 'master' | 'composition';
export const sheetKindFor = (c: IncomeClass): SheetKind => (c === 'publishing' ? 'composition' : 'master');

export type SheetFact = { id: string; songId: string; kind: SheetKind; status: string; lines: { partyId: string; units: number; position: number }[] };
export type PayeeFact = { id: string; partyId: string; currency: string; status: string; artistContactId: string | null };
export type ContractFact = {
  id: string;
  partyId: string;
  /** The party's role on the contract; the label's own side never sets a payee's rate. */
  partyRole: string;
  trackId: string | null;
  releaseId: string | null;
  artistContactId: string | null;
  rateUnits: number;
  /** The income the rate applies to, from the contract's type (`rateIncomeClass`); null = it applies to nothing. */
  incomeClass: IncomeClass | null;
  effectiveDate: string | null;
  termMonths: number | null;
};

const MASTER_RATE_TYPES: ReadonlySet<string> = new Set(['recording', 'feature', 'producer', 'beat_licence', 'distribution', 'deal_360']);
const PUBLISHING_RATE_TYPES: ReadonlySet<string> = new Set(['co_publishing']);

/** Which income a contract type's royalty rate is for. Unknown / unrelated types: null (applies to nothing). */
export function rateIncomeClass(contractType: string): IncomeClass | null {
  if (MASTER_RATE_TYPES.has(contractType)) return 'master';
  if (PUBLISHING_RATE_TYPES.has(contractType)) return 'publishing';
  return null;
}

export type AllocFacts = {
  /** `${songId}:${kind}` → every sheet of that song and kind (only live ones are used). */
  sheets: ReadonlyMap<string, readonly SheetFact[]>;
  payeeByParty: ReadonlyMap<string, PayeeFact>;
  /** partyId → its signed contracts that carry a royalty rate. */
  contracts: ReadonlyMap<string, readonly ContractFact[]>;
  /** song id → ids of the releases it is on. */
  releasesOfSong: ReadonlyMap<string, ReadonlySet<string>>;
  /** song id → the roster contacts it is the work of (inbox / linked contacts of the projects it sits in). */
  songArtists: ReadonlyMap<string, ReadonlySet<string>>;
};

export const sheetKey = (songId: string, kind: SheetKind) => `${songId}:${kind}`;

const addMonths = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, d));
  return t.toISOString().slice(0, 10);
};

/** Is the contract in term for the line's period? Unknown period = in term. */
export function inTerm(c: Pick<ContractFact, 'effectiveDate' | 'termMonths'>, periodStart: string | null, periodEnd: string | null): boolean {
  if (c.effectiveDate && periodEnd && periodEnd < c.effectiveDate) return false;
  if (c.effectiveDate && c.termMonths && periodStart && periodStart >= addMonths(c.effectiveDate, c.termMonths)) return false;
  return true;
}

const LEVEL_RANK = { song: 3, release: 2, artist: 1 } as const;

export type RateChoice = { kind: 'none' } | { kind: 'rate'; contractId: string; rateUnits: number } | { kind: 'ambiguous' };

export function chooseRate(
  candidates: readonly ContractFact[],
  ctx: { songId: string; releaseIds: ReadonlySet<string>; songArtistIds: ReadonlySet<string>; incomeClass: IncomeClass; periodStart: string | null; periodEnd: string | null },
): RateChoice {
  const applicable: { c: ContractFact; rank: number }[] = [];
  for (const c of candidates) {
    if (c.partyRole === 'label') continue;
    if (c.incomeClass !== ctx.incomeClass) continue;
    if (!inTerm(c, ctx.periodStart, ctx.periodEnd)) continue;
    if (c.trackId !== null) {
      if (c.trackId === ctx.songId) applicable.push({ c, rank: LEVEL_RANK.song });
    } else if (c.releaseId !== null) {
      if (ctx.releaseIds.has(c.releaseId)) applicable.push({ c, rank: LEVEL_RANK.release });
    } else if (c.artistContactId !== null && ctx.songArtistIds.has(c.artistContactId)) {
      applicable.push({ c, rank: LEVEL_RANK.artist });
    }
  }
  if (applicable.length === 0) return { kind: 'none' };
  const best = Math.max(...applicable.map((a) => a.rank));
  const top = applicable.filter((a) => a.rank === best).map((a) => a.c).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(top.map((c) => c.rateUnits)).size > 1) return { kind: 'ambiguous' };
  return { kind: 'rate', contractId: top[0].id, rateUnits: top[0].rateUnits };
}

export type AllocationBasis = 'split' | 'rate';
export type AllocationDraft = {
  payeeId: string;
  partyId: string;
  songId: string;
  kind: SheetKind;
  sheetId: string;
  contractId: string | null;
  basis: AllocationBasis;
  /** The split share (basis `split`) or the royalty rate (basis `rate`); 100 % = 1 000 000. */
  units: number;
  payableMinor: bigint;
};

export type Allocation = { ok: true; rows: AllocationDraft[]; retainedMinor: bigint } | { ok: false; reason: ReviewReason };

export function allocateLine(
  line: Pick<ParsedLine, 'grossMinor' | 'incomeClass' | 'periodStart' | 'periodEnd'>,
  currency: string,
  songId: string,
  facts: AllocFacts,
): Allocation {
  const kind = sheetKindFor(line.incomeClass);
  const live = (facts.sheets.get(sheetKey(songId, kind)) ?? []).filter((s) => isLive(s.status));
  if (live.length !== 1) return { ok: false, reason: 'no_sheet' };
  const sheet = live[0];
  if (sumShares(sheet.lines.map((l) => l.units)) !== FULL_SHARE) return { ok: false, reason: 'bad_split' };

  // One entry per party, in sheet order (first appearance).
  const parties: { partyId: string; units: number }[] = [];
  for (const l of [...sheet.lines].sort((a, b) => a.position - b.position || a.partyId.localeCompare(b.partyId))) {
    const existing = parties.find((p) => p.partyId === l.partyId);
    if (existing) existing.units += l.units;
    else parties.push({ partyId: l.partyId, units: l.units });
  }
  const sheetParties = new Set(parties.map((p) => p.partyId));
  const releaseIds = facts.releasesOfSong.get(songId) ?? new Set<string>();
  const songArtistIds = facts.songArtists.get(songId) ?? new Set<string>();

  const payeeOf = (partyId: string): PayeeFact | null => facts.payeeByParty.get(partyId) ?? null;
  const rateFor = (partyId: string): RateChoice =>
    chooseRate(facts.contracts.get(partyId) ?? [], {
      songId, releaseIds, songArtistIds, incomeClass: line.incomeClass, periodStart: line.periodStart, periodEnd: line.periodEnd,
    });

  // Everyone who could be paid on this line: the sheet's parties, then parties whose signed contract names this song or one of its releases.
  const extra = [...facts.contracts.keys()].filter((id) => !sheetParties.has(id)).sort();
  const candidates = [...parties.map((p) => p.partyId), ...extra];
  const choices = new Map<string, RateChoice>();
  const payees = new Map<string, PayeeFact>();
  for (const partyId of candidates) {
    const payee = payeeOf(partyId);
    if (!payee) {
      // A sheet party with no payee blocks the line; a contract-only party with no payee is simply not a candidate here.
      if (sheetParties.has(partyId)) return { ok: false, reason: 'no_payee' };
      continue;
    }
    const choice = rateFor(partyId);
    if (!sheetParties.has(partyId) && choice.kind !== 'rate') continue;
    if (!sheetParties.has(partyId) && choice.kind === 'rate' && payee.status !== 'active') return { ok: false, reason: 'payee_inactive' };
    payees.set(partyId, payee);
    choices.set(partyId, choice);
  }
  for (const choice of choices.values()) if (choice.kind === 'ambiguous') return { ok: false, reason: 'contract_ambiguous' };
  const chosen = [...payees.values()];
  if (chosen.some((p) => p.status !== 'active')) return { ok: false, reason: 'payee_inactive' };
  if (chosen.some((p) => p.currency !== currency)) return { ok: false, reason: 'currency_mismatch' };

  const gross = money(line.grossMinor, currency);
  const splitShares = allocate(gross, parties.map((p) => p.units));
  const rows: AllocationDraft[] = [];
  let units = 0;
  let paid = BigInt(0);
  const push = (partyId: string, basis: AllocationBasis, u: number, payable: Money, contractId: string | null) => {
    const payee = payees.get(partyId) as PayeeFact;
    rows.push({ payeeId: payee.id, partyId, songId, kind, sheetId: sheet.id, contractId, basis, units: u, payableMinor: payable.minor });
    units += u;
    paid += payable.minor;
  };
  parties.forEach((p, i) => {
    const choice = choices.get(p.partyId) as RateChoice;
    if (choice.kind === 'rate') push(p.partyId, 'rate', choice.rateUnits, applyShare(gross, choice.rateUnits), choice.contractId);
    else push(p.partyId, 'split', p.units, splitShares[i], null);
  });
  for (const partyId of extra) {
    const choice = choices.get(partyId);
    if (choice && choice.kind === 'rate') push(partyId, 'rate', choice.rateUnits, applyShare(gross, choice.rateUnits), choice.contractId);
  }
  // Never pay more than was received: units exactly, and the minor-unit sum as a guard against rounding.
  const abs = (n: bigint) => (n < BigInt(0) ? -n : n);
  if (units > FULL_SHARE || abs(paid) > abs(gross.minor)) return { ok: false, reason: 'terms_exceed_gross' };
  return { ok: true, rows, retainedMinor: gross.minor - paid };
}

// ── Recoupment ───────────────────────────────────────────────────────────

export type AdvanceFact = { id: string; payeeId: string; remainingMinor: bigint; createdAt: string };
export type RecoupInput = { key: string; payeeId: string; payableMinor: bigint };
export type RecoupRow = { key: string; payeeId: string; advanceId: string; amountMinor: bigint };

export function recoup(allocations: readonly RecoupInput[], advances: readonly AdvanceFact[]): RecoupRow[] {
  const remaining = new Map<string, bigint>();
  const byPayee = new Map<string, AdvanceFact[]>();
  for (const a of advances) {
    if (a.remainingMinor <= BigInt(0)) continue;
    remaining.set(a.id, a.remainingMinor);
    byPayee.set(a.payeeId, [...(byPayee.get(a.payeeId) ?? []), a]);
  }
  for (const list of byPayee.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const out: RecoupRow[] = [];
  for (const alloc of allocations) {
    let left = alloc.payableMinor;
    if (left <= BigInt(0)) continue;
    for (const adv of byPayee.get(alloc.payeeId) ?? []) {
      if (left === BigInt(0)) break;
      const have = remaining.get(adv.id) ?? BigInt(0);
      if (have <= BigInt(0)) continue;
      const take = have < left ? have : left;
      out.push({ key: alloc.key, payeeId: alloc.payeeId, advanceId: adv.id, amountMinor: take });
      remaining.set(adv.id, have - take);
      left -= take;
    }
  }
  return out;
}

// ── The whole run ────────────────────────────────────────────────────────

export type LineInput = ParsedLine;
export type LineResult = {
  lineNo: number;
  trackId: string | null;
  songId: string | null;
  reviewReason: ReviewReason | null;
};
export type AllocationResult = AllocationDraft & { lineNo: number };
export type RecoupResult = { lineNo: number; payeeId: string; advanceId: string; amountMinor: bigint };

export type RunResult = {
  lines: LineResult[];
  allocations: AllocationResult[];
  recoups: RecoupResult[];
};

export function computeEarnings(
  lines: readonly LineInput[],
  currency: string,
  match: MatchFacts,
  alloc: AllocFacts,
  advances: readonly AdvanceFact[],
): RunResult {
  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  const results: LineResult[] = [];
  const allocations: AllocationResult[] = [];
  for (const line of ordered) {
    const m = matchLine(line, match);
    if (!m.ok) {
      results.push({ lineNo: line.lineNo, trackId: m.trackId, songId: m.songId, reviewReason: m.reason });
      continue;
    }
    const a = allocateLine(line, currency, m.songId, alloc);
    if (!a.ok) {
      results.push({ lineNo: line.lineNo, trackId: m.trackId, songId: m.songId, reviewReason: a.reason });
      continue;
    }
    results.push({ lineNo: line.lineNo, trackId: m.trackId, songId: m.songId, reviewReason: null });
    for (const row of a.rows) allocations.push({ ...row, lineNo: line.lineNo });
  }
  const taken = recoup(
    allocations.map((a) => ({ key: `${a.lineNo}:${a.payeeId}`, payeeId: a.payeeId, payableMinor: a.payableMinor })),
    advances,
  );
  const recoups = taken.map((t) => ({ lineNo: Number(t.key.slice(0, t.key.indexOf(':'))), payeeId: t.payeeId, advanceId: t.advanceId, amountMinor: t.amountMinor }));
  return { lines: results, allocations, recoups };
}
