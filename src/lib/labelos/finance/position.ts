/**
 * A payee's financial position (LABEL-64). Pure: the facts LABEL-61/62/63 already stored in,
 * one row per payee out. Nothing is recomputed that a statement already froze — the figures are
 * sums over allocations, recoupments, statements and payments, in the payee's ONE currency.
 *
 *   advanced        face value of live advances (recoupable / non-recoupable)
 *   unrecouped      what a payee still owes the label on recoupable advances
 *   earned          Σ allocation payable (their share of the money received)
 *   recouped        Σ recoupments (earnings kept back to repay advances)
 *   netEarned       earned − recouped
 *   onStatements    Σ net of non-void statements (draft, approved, issued)
 *   notOnStatement  netEarned − onStatements: earned but not yet on any statement
 *   issued          Σ net of ISSUED statements: what has been told to the payee
 *   paid            Σ live payments recorded
 *   owed            issued − paid: the label owes the payee this much now
 *
 * The app never moves money: `paid` is a record somebody made elsewhere.
 */
import { advanceState, type AdvanceFacts, type AdvanceRow } from './advances';
import { minorFromDb } from './money';

const ZERO = BigInt(0);

export type PositionPayee = { id: string; name: string | null; currency: string; artistContactId: string | null; status: string };

export type PositionFacts = {
  payees: readonly PositionPayee[];
  advances: readonly (AdvanceRow & { facts: AdvanceFacts })[];
  /** payee id → Σ allocation payable (minor). */
  earnedByPayee: ReadonlyMap<string, bigint>;
  /** payee id → Σ recoupments (minor). */
  recoupedByPayee: ReadonlyMap<string, bigint>;
  statements: readonly { payee_id: string; status: string; net_minor: unknown }[];
  payments: readonly { payee_id: string; amount_minor: unknown; voided_at: string | null }[];
};

export type PayeePosition = {
  payeeId: string;
  name: string | null;
  currency: string;
  artistContactId: string | null;
  active: boolean;
  recoupableAdvanced: bigint;
  nonRecoupableAdvanced: bigint;
  unrecouped: bigint;
  earned: bigint;
  recouped: bigint;
  netEarned: bigint;
  onStatements: bigint;
  notOnStatement: bigint;
  issued: bigint;
  paid: bigint;
  owed: bigint;
};

const get = (m: ReadonlyMap<string, bigint>, k: string): bigint => m.get(k) ?? ZERO;

export function payeePositions(f: PositionFacts): PayeePosition[] {
  const adv = new Map<string, { rec: bigint; non: bigint; unrec: bigint }>();
  for (const a of f.advances) {
    const s = advanceState(a, a.facts);
    if (s.status === 'void') continue;
    const t = adv.get(a.payee_id) ?? { rec: ZERO, non: ZERO, unrec: ZERO };
    if (a.kind === 'recoupable') {
      t.rec += s.amount;
      t.unrec += s.remaining;
    } else {
      t.non += s.amount;
    }
    adv.set(a.payee_id, t);
  }
  const stmt = new Map<string, { all: bigint; issued: bigint }>();
  for (const s of f.statements) {
    if (s.status === 'void') continue;
    const t = stmt.get(s.payee_id) ?? { all: ZERO, issued: ZERO };
    const n = minorFromDb(s.net_minor);
    t.all += n;
    if (s.status === 'issued') t.issued += n;
    stmt.set(s.payee_id, t);
  }
  const paid = new Map<string, bigint>();
  for (const p of f.payments) {
    if (p.voided_at) continue;
    paid.set(p.payee_id, get(paid, p.payee_id) + minorFromDb(p.amount_minor));
  }
  return f.payees.map((p) => {
    const a = adv.get(p.id) ?? { rec: ZERO, non: ZERO, unrec: ZERO };
    const st = stmt.get(p.id) ?? { all: ZERO, issued: ZERO };
    const earned = get(f.earnedByPayee, p.id);
    const recouped = get(f.recoupedByPayee, p.id);
    const netEarned = earned - recouped;
    const paidSum = get(paid, p.id);
    return {
      payeeId: p.id,
      name: p.name,
      currency: p.currency,
      artistContactId: p.artistContactId,
      active: p.status === 'active',
      recoupableAdvanced: a.rec,
      nonRecoupableAdvanced: a.non,
      unrecouped: a.unrec,
      earned,
      recouped,
      netEarned,
      onStatements: st.all,
      notOnStatement: netEarned - st.all,
      issued: st.issued,
      paid: paidSum,
      owed: st.issued - paidSum,
    };
  });
}

export type PositionTotals = Omit<PayeePosition, 'payeeId' | 'name' | 'artistContactId' | 'active'> & { payees: number };

/** Totals per currency; two currencies are two rows. */
export function positionTotals(positions: readonly PayeePosition[]): PositionTotals[] {
  const by = new Map<string, PositionTotals>();
  for (const p of positions) {
    let t = by.get(p.currency);
    if (!t) {
      t = {
        currency: p.currency, recoupableAdvanced: ZERO, nonRecoupableAdvanced: ZERO, unrecouped: ZERO, earned: ZERO, recouped: ZERO,
        netEarned: ZERO, onStatements: ZERO, notOnStatement: ZERO, issued: ZERO, paid: ZERO, owed: ZERO, payees: 0,
      };
      by.set(p.currency, t);
    }
    t.recoupableAdvanced += p.recoupableAdvanced;
    t.nonRecoupableAdvanced += p.nonRecoupableAdvanced;
    t.unrecouped += p.unrecouped;
    t.earned += p.earned;
    t.recouped += p.recouped;
    t.netEarned += p.netEarned;
    t.onStatements += p.onStatements;
    t.notOnStatement += p.notOnStatement;
    t.issued += p.issued;
    t.paid += p.paid;
    t.owed += p.owed;
    t.payees += 1;
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The JSON of a position: strings for money, field by field. */
export function positionView(p: PayeePosition) {
  const s = (n: bigint) => n.toString();
  return {
    payeeId: p.payeeId,
    name: p.name,
    currency: p.currency,
    artistContactId: p.artistContactId,
    active: p.active,
    recoupableAdvancedMinor: s(p.recoupableAdvanced),
    nonRecoupableAdvancedMinor: s(p.nonRecoupableAdvanced),
    unrecoupedMinor: s(p.unrecouped),
    earnedMinor: s(p.earned),
    recoupedMinor: s(p.recouped),
    netEarnedMinor: s(p.netEarned),
    onStatementsMinor: s(p.onStatements),
    notOnStatementMinor: s(p.notOnStatement),
    issuedMinor: s(p.issued),
    paidMinor: s(p.paid),
    owedMinor: s(p.owed),
  };
}
export type PositionView = ReturnType<typeof positionView>;
