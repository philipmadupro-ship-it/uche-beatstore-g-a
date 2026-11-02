import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError } from './money';
import {
  buildStatementLines,
  groupBySong,
  paymentPosition,
  planApproval,
  planPayment,
  statementActions,
  statementNet,
  statementTotals,
  verifyAgainstSources,
  type AllocationFact,
  type RecoupmentFact,
} from './statement-calc';

const B = (n: number | string) => BigInt(n);
const titles = new Map([['s1', 'Night Shift'], ['s2', 'Alpha']]);
const alloc = (lineId: string, song: string, payable: number | string, units = 600000, currency = 'USD'): AllocationFact => ({ lineId, songTrackId: song, units, payableMinor: B(payable), currency });
const rec = (lineId: string, advance: string, amount: number | string, currency = 'USD'): RecoupmentFact => ({ lineId, advanceId: advance, amountMinor: B(amount), currency });

describe('buildStatementLines — a copy of the sources', () => {
  it('golden: 600 earned, 500 recouped → net 100, earnings by title, then recoupments', () => {
    const { lines, netMinor } = buildStatementLines('USD', [alloc('l1', 's1', 600), alloc('l2', 's2', 40)], [rec('l1', 'adv1', 500)], titles);
    expect(netMinor).toBe(B(140));
    expect(lines.map((l) => [l.kind, l.description, l.amountMinor.toString(), l.position])).toEqual([
      ['earning', 'Alpha', '40', 0],
      ['earning', 'Night Shift', '600', 1],
      ['recoupment', 'Advance recouped', '-500', 2],
    ]);
    expect(lines[2].advanceId).toBe('adv1');
    expect(lines[1].shareUnits).toBe(600000);
  });

  it('is deterministic whatever the input order', () => {
    const a = [alloc('l1', 's1', 6), alloc('l2', 's1', 7), alloc('l3', 's2', 8)];
    const r = [rec('l1', 'b', 1), rec('l2', 'a', 2)];
    const one = buildStatementLines('USD', a, r, titles).lines;
    const two = buildStatementLines('USD', [...a].reverse(), [...r].reverse(), titles).lines;
    expect(two).toEqual(one);
  });

  it('refuses a line in another currency rather than adding it in', () => {
    expect(() => buildStatementLines('USD', [alloc('l1', 's1', 5, 1, 'EUR')], [], titles)).toThrow(CurrencyMismatchError);
    expect(() => buildStatementLines('USD', [alloc('l1', 's1', 5)], [rec('l1', 'a', 1, 'GBP')], titles)).toThrow(CurrencyMismatchError);
  });

  it('refuses a non-positive recoupment, and a total outside int64', () => {
    expect(() => buildStatementLines('USD', [alloc('l1', 's1', 5)], [rec('l1', 'a', 0)], titles)).toThrow();
    expect(() => buildStatementLines('USD', [alloc('l1', 's1', '9223372036854775807'), alloc('l2', 's1', 1)], [], titles)).toThrow(RangeError);
  });

  it('keeps a negative earning (a refund line) and the exact digits of a large one', () => {
    const { netMinor } = buildStatementLines('USD', [alloc('l1', 's1', '9007199254740993'), alloc('l2', 's1', -3)], [], titles);
    expect(netMinor).toBe(B('9007199254740990'));
  });

  it('a statement with nothing recouped is just its earnings; a zero line stays', () => {
    const { lines, netMinor } = buildStatementLines('USD', [alloc('l1', 's1', 0)], [], titles);
    expect(lines).toHaveLength(1);
    expect(netMinor).toBe(B(0));
  });
});

describe('property: totals equal Σ allocations − Σ recoupments', () => {
  // A small deterministic generator (no Math.random: a failure must be reproducible).
  let seed = 12345;
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };

  it('holds for 300 random statements, and verifyAgainstSources agrees', () => {
    for (let round = 0; round < 300; round += 1) {
      const allocations: AllocationFact[] = [];
      const n = 1 + next(12);
      for (let i = 0; i < n; i += 1) allocations.push(alloc(`l${i}`, `s${next(4)}`, next(2) === 0 ? next(100000) : -next(500), next(1000001)));
      const recoupments: RecoupmentFact[] = [];
      for (let i = 0; i < n; i += 1) if (allocations[i].payableMinor > B(0) && next(3) === 0) recoupments.push(rec(`l${i}`, `adv${next(3)}`, 1 + next(Number(allocations[i].payableMinor))));
      // one recoupment per (line, advance)
      const seen = new Set<string>();
      const unique = recoupments.filter((r) => (seen.has(`${r.lineId}|${r.advanceId}`) ? false : (seen.add(`${r.lineId}|${r.advanceId}`), true)));

      const { lines, netMinor } = buildStatementLines('USD', allocations, unique, new Map());
      const expected = allocations.reduce((s, a) => s + a.payableMinor, B(0)) - unique.reduce((s, r) => s + r.amountMinor, B(0));
      expect(netMinor).toBe(expected);
      expect(statementNet(lines)).toBe(expected);
      expect(statementTotals(lines).netMinor).toBe(expected);
      expect(verifyAgainstSources(lines, netMinor, allocations, unique)).toBe(true);
    }
  });

  it('verifyAgainstSources rejects any tampering', () => {
    const allocations = [alloc('l1', 's1', 600), alloc('l2', 's2', 40)];
    const recoupments = [rec('l1', 'a', 500)];
    const { lines, netMinor } = buildStatementLines('USD', allocations, recoupments, titles);
    expect(verifyAgainstSources(lines, netMinor, allocations, recoupments)).toBe(true);
    // wrong amount
    expect(verifyAgainstSources(lines.map((l, i) => (i === 0 ? { ...l, amountMinor: l.amountMinor + B(1) } : l)), netMinor + B(1), allocations, recoupments)).toBe(false);
    // missing line
    expect(verifyAgainstSources(lines.slice(1), netMinor - lines[0].amountMinor, allocations, recoupments)).toBe(false);
    // an extra line
    expect(verifyAgainstSources([...lines, { ...lines[0] }], netMinor + lines[0].amountMinor, allocations, recoupments)).toBe(false);
    // the net is not the sum
    expect(verifyAgainstSources(lines, netMinor + B(1), allocations, recoupments)).toBe(false);
    // recouped twice
    expect(verifyAgainstSources([...lines, lines[2]], netMinor - B(500), allocations, recoupments)).toBe(false);
    // a recoupment that is not a deduction of the source's size
    expect(verifyAgainstSources(lines.map((l) => (l.kind === 'recoupment' ? { ...l, amountMinor: B(-400) } : l)), netMinor + B(100), allocations, recoupments)).toBe(false);
  });
});

describe('groupBySong', () => {
  it('adds a song’s earnings, keeps a single share, and totals the recoupments apart', () => {
    const { lines } = buildStatementLines('USD', [alloc('l1', 's1', 600), alloc('l2', 's1', 60), alloc('l3', 's2', 40, 400000)], [rec('l1', 'a', 500)], titles);
    const g = groupBySong(lines);
    expect(g.songs.map((s) => [s.title, s.earnedMinor.toString(), s.lines, s.shareUnits])).toEqual([['Alpha', '40', 1, 400000], ['Night Shift', '660', 2, 600000]]);
    expect(g.recoupedMinor).toBe(B(500));
    expect(g.recoupments).toBe(1);
  });

  it('drops the share when a song’s lines disagree', () => {
    const { lines } = buildStatementLines('USD', [alloc('l1', 's1', 6, 600000), alloc('l2', 's1', 6, 500000)], [], titles);
    expect(groupBySong(lines).songs[0].shareUnits).toBeNull();
  });
});

describe('payments: partial, never above the net', () => {
  it('derives the state from live payments', () => {
    expect(paymentPosition(B(160), []).state).toBe('unpaid');
    expect(paymentPosition(B(160), [{ amountMinor: B(60), voided: false }])).toMatchObject({ state: 'partial', paidMinor: B(60), outstandingMinor: B(100) });
    expect(paymentPosition(B(160), [{ amountMinor: B(60), voided: false }, { amountMinor: B(100), voided: false }]).state).toBe('paid');
    expect(paymentPosition(B(160), [{ amountMinor: B(160), voided: true }]).state).toBe('unpaid');
    expect(paymentPosition(B(0), []).state).toBe('nothing_due');
    expect(paymentPosition(B(-50), []).state).toBe('nothing_due');
  });

  it('plans a payment', () => {
    const pos = paymentPosition(B(160), [{ amountMinor: B(60), voided: false }]);
    expect(planPayment(pos, B(100))).toEqual({ ok: true });
    expect(planPayment(pos, B(101))).toEqual({ ok: false, code: 'exceeds_net', remainingMinor: B(100) });
    expect(planPayment(pos, B(0)).ok).toBe(false);
    expect(planPayment(pos, B(-5)).ok).toBe(false);
    expect(planPayment(paymentPosition(B(-5), []), B(1)).ok).toBe(false);
  });
});

describe('the approval rule', () => {
  it('the generator may not approve, unless an owner', () => {
    expect(planApproval({ generatedBy: 'u1', actor: 'u1', actorIsOwner: false })).toEqual({ ok: false, code: 'self_approval' });
    expect(planApproval({ generatedBy: 'u1', actor: 'u1', actorIsOwner: true })).toEqual({ ok: true });
    expect(planApproval({ generatedBy: 'u1', actor: 'u2', actorIsOwner: false })).toEqual({ ok: true });
    expect(planApproval({ generatedBy: null, actor: 'u2', actorIsOwner: false })).toEqual({ ok: true });
  });
});

describe('statementActions', () => {
  const caps = (...c: string[]) => new Set(c);
  it('offers what the status and the capabilities allow', () => {
    expect(statementActions('draft', caps('finance.read', 'finance.write'), B(0))).toMatchObject({ regenerate: true, approve: false, issue: false, recordPayment: false });
    expect(statementActions('draft', caps('finance.approve'), B(0))).toMatchObject({ approve: true, regenerate: false });
    expect(statementActions('approved', caps('finance.approve'), B(0))).toMatchObject({ issue: true, approve: false, void: true });
    expect(statementActions('issued', caps('finance.write'), B(10))).toMatchObject({ recordPayment: true, void: false });
    expect(statementActions('issued', caps('finance.write'), B(0)).recordPayment).toBe(false);
    expect(statementActions('void', caps('finance.write', 'finance.approve'), B(10))).toEqual({ regenerate: false, approve: false, issue: false, void: false, recordPayment: false, voidPayment: false });
  });
});
