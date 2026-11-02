/**
 * The arithmetic of a payee statement (LABEL-63). Pure; integer minor units in `bigint`,
 * never a float; the same statement for the same inputs, in the same order.
 *
 * A statement is a COPY of what LABEL-62 already worked out, never a new
 * calculation: for one payee and one period, one `earning` line per allocation
 * (its `payable_minor`, as the royalty run set it) and one `recoupment` line per
 * `earnings_recoupments` row (negated). Nothing is rounded, split, or recouped
 * here — recouping an advance a second time is impossible because this module
 * has no advance balance to take from. The database proves the same equality
 * again (`labelos_statement_sources_ok`, migration 181); `verifyAgainstSources`
 * is its TypeScript twin and the property tests run it on random inputs.
 *
 * Statement currency = payee currency. An allocation or recoupment in another
 * currency cannot exist (180), and if one is handed in anyway it is refused
 * (`CurrencyMismatchError`), never converted and never summed in.
 */
import { CurrencyMismatchError, INT64_MAX, INT64_MIN } from './money';

export type AllocationFact = { lineId: string; songTrackId: string; units: number; payableMinor: bigint; currency: string };
export type RecoupmentFact = { lineId: string; advanceId: string; amountMinor: bigint; currency: string };

export type StatementLineKind = 'earning' | 'recoupment';
export type StatementLineDraft = {
  kind: StatementLineKind;
  earningsLineId: string;
  advanceId: string | null;
  trackId: string | null;
  description: string;
  shareUnits: number | null;
  amountMinor: bigint;
  position: number;
};

const ZERO = BigInt(0);
export const RECOUPMENT_DESCRIPTION = 'Advance recouped';
const MAX_DESCRIPTION = 200;

const clip = (text: string): string => (text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION) : text);

function checked(total: bigint): bigint {
  if (total > INT64_MAX || total < INT64_MIN) throw new RangeError('A statement total is out of range');
  return total;
}

/**
 * The lines of a statement, in a stable order: earnings by song title (then line id), then the
 * recoupments by advance (then line id). `titles` maps a song id to the title the statement
 * records (a snapshot, so a later rename changes nothing already issued).
 */
export function buildStatementLines(
  currency: string,
  allocations: readonly AllocationFact[],
  recoupments: readonly RecoupmentFact[],
  titles: ReadonlyMap<string, string>,
): { lines: StatementLineDraft[]; netMinor: bigint } {
  for (const a of allocations) if (a.currency.trim() !== currency) throw new CurrencyMismatchError(currency, a.currency.trim());
  for (const r of recoupments) if (r.currency.trim() !== currency) throw new CurrencyMismatchError(currency, r.currency.trim());
  const title = (songId: string): string => titles.get(songId) ?? 'Song';
  const earnings = [...allocations].sort((a, b) => title(a.songTrackId).localeCompare(title(b.songTrackId)) || a.lineId.localeCompare(b.lineId));
  const recoups = [...recoupments].sort((a, b) => a.advanceId.localeCompare(b.advanceId) || a.lineId.localeCompare(b.lineId));
  const lines: StatementLineDraft[] = [];
  for (const a of earnings) {
    lines.push({
      kind: 'earning',
      earningsLineId: a.lineId,
      advanceId: null,
      trackId: a.songTrackId,
      description: clip(title(a.songTrackId)),
      shareUnits: a.units,
      amountMinor: a.payableMinor,
      position: lines.length,
    });
  }
  for (const r of recoups) {
    if (r.amountMinor <= ZERO) throw new RangeError('A recoupment is a positive amount taken off earnings');
    lines.push({
      kind: 'recoupment',
      earningsLineId: r.lineId,
      advanceId: r.advanceId,
      trackId: null,
      description: RECOUPMENT_DESCRIPTION,
      shareUnits: null,
      amountMinor: -r.amountMinor,
      position: lines.length,
    });
  }
  return { lines, netMinor: statementNet(lines) };
}

export function statementNet(lines: readonly { amountMinor: bigint }[]): bigint {
  let total = ZERO;
  for (const l of lines) total = checked(total + l.amountMinor);
  return total;
}

export function statementTotals(lines: readonly { kind: string; amountMinor: bigint }[]): { earnedMinor: bigint; recoupedMinor: bigint; adjustedMinor: bigint; netMinor: bigint } {
  let earned = ZERO;
  let recouped = ZERO;
  let adjusted = ZERO;
  for (const l of lines) {
    if (l.kind === 'earning') earned += l.amountMinor;
    else if (l.kind === 'recoupment') recouped += -l.amountMinor;
    else adjusted += l.amountMinor;
  }
  return { earnedMinor: checked(earned), recoupedMinor: checked(recouped), adjustedMinor: checked(adjusted), netMinor: checked(earned - recouped + adjusted) };
}

/**
 * The equality that matters: the lines are the sources, one to one and amount for amount, and the
 * net is Σ allocations − Σ recoupments. A false answer means the statement is stale or wrong.
 */
export function verifyAgainstSources(
  lines: readonly { kind: string; earningsLineId: string | null; advanceId: string | null; amountMinor: bigint }[],
  netMinor: bigint,
  allocations: readonly AllocationFact[],
  recoupments: readonly RecoupmentFact[],
): boolean {
  const earn = new Map<string, bigint>();
  const rec = new Map<string, bigint>();
  for (const l of lines) {
    if (l.earningsLineId === null) return false;
    if (l.kind === 'earning') {
      if (earn.has(l.earningsLineId)) return false;
      earn.set(l.earningsLineId, l.amountMinor);
    } else if (l.kind === 'recoupment' && l.advanceId !== null) {
      const key = `${l.earningsLineId}|${l.advanceId}`;
      if (rec.has(key)) return false;
      rec.set(key, l.amountMinor);
    } else {
      return false;
    }
  }
  if (earn.size !== allocations.length || rec.size !== recoupments.length) return false;
  let expected = ZERO;
  for (const a of allocations) {
    if (earn.get(a.lineId) !== a.payableMinor) return false;
    expected += a.payableMinor;
  }
  for (const r of recoupments) {
    if (rec.get(`${r.lineId}|${r.advanceId}`) !== -r.amountMinor) return false;
    expected -= r.amountMinor;
  }
  return expected === netMinor && statementNet(lines) === netMinor;
}

// ── Reading a statement ──────────────────────────────────────────────────

export type SongRow = { trackId: string | null; title: string; earnedMinor: bigint; lines: number; shareUnits: number | null };

/** The statement as people read it: one row per song (its earnings added), then the advances recouped. */
export function groupBySong(lines: readonly { kind: string; trackId: string | null; description: string | null; shareUnits: number | null; amountMinor: bigint }[]): {
  songs: SongRow[];
  recoupedMinor: bigint;
  recoupments: number;
} {
  const bySong = new Map<string, SongRow>();
  let recouped = ZERO;
  let recoupments = 0;
  for (const l of lines) {
    if (l.kind === 'recoupment') {
      recouped += -l.amountMinor;
      recoupments += 1;
      continue;
    }
    const key = l.trackId ?? `t:${l.description ?? ''}`;
    const row = bySong.get(key) ?? { trackId: l.trackId, title: l.description ?? 'Song', earnedMinor: ZERO, lines: 0, shareUnits: l.shareUnits };
    row.earnedMinor += l.amountMinor;
    row.lines += 1;
    // Lines of one song may sit on different sheets / rates: a single share only when they all agree.
    if (row.shareUnits !== l.shareUnits) row.shareUnits = null;
    bySong.set(key, row);
  }
  return { songs: [...bySong.values()].sort((a, b) => a.title.localeCompare(b.title)), recoupedMinor: recouped, recoupments };
}

// ── Payments ─────────────────────────────────────────────────────────────

export type PaymentFact = { amountMinor: bigint; voided: boolean };
export type PaymentState = 'nothing_due' | 'unpaid' | 'partial' | 'paid';
export type PaymentPosition = { netMinor: bigint; paidMinor: bigint; outstandingMinor: bigint; state: PaymentState };

/** Where an ISSUED statement stands: derived from its live payments, never stored. */
export function paymentPosition(netMinor: bigint, payments: readonly PaymentFact[]): PaymentPosition {
  let paid = ZERO;
  for (const p of payments) if (!p.voided) paid = checked(paid + p.amountMinor);
  if (netMinor <= ZERO) return { netMinor, paidMinor: paid, outstandingMinor: ZERO, state: 'nothing_due' };
  const outstanding = netMinor > paid ? netMinor - paid : ZERO;
  return { netMinor, paidMinor: paid, outstandingMinor: outstanding, state: paid === ZERO ? 'unpaid' : paid >= netMinor ? 'paid' : 'partial' };
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  nothing_due: 'Nothing due',
  unpaid: 'Unpaid',
  partial: 'Partly paid',
  paid: 'Paid',
};

export type PaymentPlan = { ok: true } | { ok: false; code: 'not_positive' | 'exceeds_net'; remainingMinor: bigint };

/** A payment is positive and never takes the total above the statement's net. */
export function planPayment(position: PaymentPosition, amountMinor: bigint): PaymentPlan {
  if (amountMinor <= ZERO) return { ok: false, code: 'not_positive', remainingMinor: position.outstandingMinor };
  if (position.paidMinor + amountMinor > position.netMinor) return { ok: false, code: 'exceeds_net', remainingMinor: position.outstandingMinor };
  return { ok: true };
}

// ── Who may do what ──────────────────────────────────────────────────────

/**
 * THE APPROVAL RULE (stated once; the database re-checks it under the row lock): the person who generated a
 * draft may not approve it, unless they are an OWNER of the organization. `finance.approve` is the capability
 * the route asks for before this is looked at.
 */
export function planApproval(input: { generatedBy: string | null; actor: string; actorIsOwner: boolean }): { ok: true } | { ok: false; code: 'self_approval' } {
  if (input.generatedBy !== null && input.generatedBy === input.actor && !input.actorIsOwner) return { ok: false, code: 'self_approval' };
  return { ok: true };
}

export type StatementStatus = 'draft' | 'approved' | 'issued' | 'void';
export type StatementActions = { regenerate: boolean; approve: boolean; issue: boolean; void: boolean; recordPayment: boolean; voidPayment: boolean };

/** The buttons a statement offers a viewer; the routes enforce the same rules. */
export function statementActions(status: string, caps: ReadonlySet<string>, outstandingMinor: bigint): StatementActions {
  const write = caps.has('finance.write');
  const approve = caps.has('finance.approve');
  return {
    regenerate: status === 'draft' && write,
    approve: status === 'draft' && approve,
    issue: status === 'approved' && approve,
    void: (status === 'draft' || status === 'approved' || status === 'issued') && approve,
    recordPayment: status === 'issued' && write && outstandingMinor > ZERO,
    voidPayment: status === 'issued' && write,
  };
}
