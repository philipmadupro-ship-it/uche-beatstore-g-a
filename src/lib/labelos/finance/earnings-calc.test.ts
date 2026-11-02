import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './earnings-csv';
import { buildLines } from './earnings-import';
import {
  allocateLine, chooseRate, computeEarnings, inTerm, matchLine, recoup,
  type AdvanceFact, type AllocFacts, type ContractFact, type MatchFacts, type SheetFact,
} from './earnings-calc';

const S1 = 'song-1', S2 = 'song-2-no-sheet', S3 = 'song-3-eur', S4 = 'song-4-bad-split', S5 = 'song-5-no-payee';
const R1 = 'rec-1', R2 = 'rec-2', R3 = 'rec-3', R4 = 'rec-4', R5 = 'rec-5', RDUP1 = 'rec-dup-a', RDUP2 = 'rec-dup-b', RORPHAN = 'rec-orphan';
const ARA = 'party-ara', PAT = 'party-pat', BO = 'party-bo', EUROS = 'party-euro', NOBODY = 'party-nobody';
const Y = (party: string) => `payee-${party}`;

const sheet = (id: string, songId: string, lines: [string, number][], over: Partial<SheetFact> = {}): SheetFact => ({
  id, songId, kind: 'master', status: 'signed', lines: lines.map(([partyId, units], position) => ({ partyId, units, position })), ...over,
});

const match: MatchFacts = {
  recordingsByIsrc: new Map([
    ['USABC2600001', [R1]], ['USABC2600002', [R2]], ['USABC2600003', [R3]], ['USABC2600004', [R4]], ['USABC2600005', [R5]],
    ['USABC2600099', [RDUP1, RDUP2]], ['USABC2600098', [RORPHAN]],
  ]),
  recordingsByUpc: new Map([['012345678905', [R1]], ['012345678912', [R1, R2]]]),
  songsOf: new Map([[R1, [S1]], [R2, [S2]], [R3, [S3]], [R4, [S4]], [R5, [S5]], [RDUP1, [S1]], [RDUP2, [S1]]]),
};

const patContract: ContractFact = {
  id: 'contract-pat', partyId: PAT, partyRole: 'producer', trackId: S1, releaseId: null, artistContactId: null, rateUnits: 185000, effectiveDate: '2026-01-01', termMonths: 24,
};

const alloc: AllocFacts = {
  sheets: new Map<string, SheetFact[]>([
    [`${S1}:master`, [sheet('sheet-1', S1, [[ARA, 500000], [PAT, 333333], [BO, 166667]])]],
    [`${S3}:master`, [sheet('sheet-3', S3, [[ARA, 600000], [EUROS, 400000]])]],
    [`${S4}:master`, [sheet('sheet-4', S4, [[ARA, 500000], [BO, 400000]])]],
    [`${S5}:master`, [sheet('sheet-5', S5, [[ARA, 500000], [NOBODY, 500000]])]],
  ]),
  payeeByParty: new Map([
    [ARA, { id: Y(ARA), partyId: ARA, currency: 'USD', status: 'active', artistContactId: 'contact-ara' }],
    [PAT, { id: Y(PAT), partyId: PAT, currency: 'USD', status: 'active', artistContactId: null }],
    [BO, { id: Y(BO), partyId: BO, currency: 'USD', status: 'active', artistContactId: 'contact-bo' }],
    [EUROS, { id: Y(EUROS), partyId: EUROS, currency: 'EUR', status: 'active', artistContactId: null }],
  ]),
  contracts: new Map([[PAT, [patContract]]]),
  releasesOfSong: new Map(),
};

const advances: AdvanceFact[] = [
  { id: 'adv-2', payeeId: Y(ARA), remainingMinor: BigInt(3000), createdAt: '2026-03-01' },
  { id: 'adv-1', payeeId: Y(ARA), remainingMinor: BigInt(5000), createdAt: '2026-02-01' },
  { id: 'adv-bo', payeeId: Y(BO), remainingMinor: BigInt(10), createdAt: '2026-02-01' },
];

const line = (lineNo: number, isrc: string | null, grossMinor: number, extra: Record<string, unknown> = {}) => ({
  lineNo, isrc, upc: null, title: null, store: null, territory: null, units: null, grossMinor: BigInt(grossMinor), periodStart: '2026-09-01', periodEnd: '2026-09-30', incomeClass: 'master' as const, ...extra,
});

describe('matchLine', () => {
  it('matches by ISRC, falls back to UPC, never guesses', () => {
    expect(matchLine({ isrc: 'USABC2600001', upc: null }, match)).toEqual({ ok: true, trackId: R1, songId: S1 });
    expect(matchLine({ isrc: 'USZZZ0000000', upc: '012345678905' }, match)).toEqual({ ok: true, trackId: R1, songId: S1 });
    expect(matchLine({ isrc: null, upc: null }, match)).toMatchObject({ ok: false, reason: 'no_identifier' });
    expect(matchLine({ isrc: 'USZZZ0000000', upc: null }, match)).toMatchObject({ ok: false, reason: 'no_match' });
    expect(matchLine({ isrc: 'USABC2600099', upc: null }, match)).toMatchObject({ ok: false, reason: 'ambiguous_match' });
    expect(matchLine({ isrc: null, upc: '012345678912' }, match)).toMatchObject({ ok: false, reason: 'ambiguous_match' });
    expect(matchLine({ isrc: 'USABC2600098', upc: null }, match)).toMatchObject({ ok: false, reason: 'no_song', trackId: RORPHAN });
  });
});

describe('allocateLine', () => {
  it('splits by the sheet exactly (largest remainder, ties to the earlier row) and applies a signed contract rate half to even', () => {
    const r = allocateLine(line(2, 'x', 10001), 'USD', S1, alloc);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.shareMinor, x.payableMinor, x.retainedMinor])).toEqual([
      [ARA, BigInt(5000), BigInt(5000), BigInt(0)],
      [PAT, BigInt(3334), BigInt(617), BigInt(2717)], // 3334 × 18.5 % = 616.79 → 617
      [BO, BigInt(1667), BigInt(1667), BigInt(0)],
    ]);
    expect(r.ok && r.rows.reduce((s, x) => s + x.shareMinor, BigInt(0))).toBe(BigInt(10001));
  });

  it('allocates a negative line as the mirror of the positive one', () => {
    const r = allocateLine(line(2, 'x', -200), 'USD', S1, alloc);
    expect(r.ok && r.rows.map((x) => x.shareMinor)).toEqual([BigInt(-100), BigInt(-67), BigInt(-33)]);
    expect(r.ok && r.rows[1].payableMinor).toBe(BigInt(-12)); // −67 × 18.5 % = −12.395
  });

  it('puts the WHOLE line in review rather than guess', () => {
    expect(allocateLine(line(2, 'x', 100), 'USD', S2, alloc)).toEqual({ ok: false, reason: 'no_sheet' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S4, alloc)).toEqual({ ok: false, reason: 'bad_split' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S5, alloc)).toEqual({ ok: false, reason: 'no_payee' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S3, alloc)).toEqual({ ok: false, reason: 'currency_mismatch' });
    // publishing income needs a COMPOSITION sheet, which S1 does not have.
    expect(allocateLine(line(2, 'x', 100, { incomeClass: 'publishing' }), 'USD', S1, alloc)).toEqual({ ok: false, reason: 'no_sheet' });
  });

  it('ignores a draft or superseded sheet and refuses two live ones', () => {
    const only = (s: SheetFact[]): AllocFacts => ({ ...alloc, sheets: new Map([[`${S1}:master`, s]]) });
    const base = sheet('a', S1, [[ARA, 1000000]]);
    expect(allocateLine(line(2, 'x', 100), 'USD', S1, only([{ ...base, status: 'draft' }]))).toEqual({ ok: false, reason: 'no_sheet' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S1, only([{ ...base, status: 'superseded' }, { ...base, id: 'b', status: 'circulated' }]))).toMatchObject({ ok: true });
    expect(allocateLine(line(2, 'x', 100), 'USD', S1, only([base, { ...base, id: 'b' }]))).toEqual({ ok: false, reason: 'no_sheet' });
  });

  it('merges a party on two rows into one allocation', () => {
    const two: AllocFacts = { ...alloc, sheets: new Map([[`${S1}:master`, [sheet('s', S1, [[ARA, 250000], [BO, 500000], [ARA, 250000]])]]]) };
    const r = allocateLine(line(2, 'x', 1000), 'USD', S1, two);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.shareMinor, x.shareUnits])).toEqual([[ARA, BigInt(500), 500000], [BO, BigInt(500), 500000]]);
  });
});

describe('contract rate choice', () => {
  const ctx = { songId: S1, releaseIds: new Set(['rel-1']), payeeArtistId: 'contact-ara', periodStart: '2026-09-01', periodEnd: '2026-09-30' };
  const c = (over: Partial<ContractFact>): ContractFact => ({ ...patContract, ...over });

  it('prefers song over release over artist, and refuses two different rates at the best level', () => {
    const artistWide = c({ id: 'c-a', trackId: null, artistContactId: 'contact-ara', rateUnits: 100000 });
    const release = c({ id: 'c-r', trackId: null, releaseId: 'rel-1', rateUnits: 150000 });
    const song = c({ id: 'c-s', rateUnits: 200000 });
    expect(chooseRate([artistWide, release, song], ctx)).toEqual({ kind: 'rate', contractId: 'c-s', rateUnits: 200000 });
    expect(chooseRate([artistWide, release], ctx)).toEqual({ kind: 'rate', contractId: 'c-r', rateUnits: 150000 });
    expect(chooseRate([artistWide], ctx)).toEqual({ kind: 'rate', contractId: 'c-a', rateUnits: 100000 });
    expect(chooseRate([song, c({ id: 'c-s2', rateUnits: 210000 })], ctx)).toEqual({ kind: 'ambiguous' });
    expect(chooseRate([c({ id: 'z', rateUnits: 200000 }), song], ctx)).toEqual({ kind: 'rate', contractId: 'c-s', rateUnits: 200000 });
  });

  it('ignores the label side, other songs, other artists and contracts out of term', () => {
    expect(chooseRate([c({ partyRole: 'label' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ trackId: 'other' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ trackId: null, artistContactId: 'someone-else' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ effectiveDate: '2026-10-01' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ effectiveDate: '2024-01-01', termMonths: 12 })], ctx)).toEqual({ kind: 'none' });
    expect(inTerm({ effectiveDate: '2024-01-01', termMonths: 12 }, '2024-12-01', '2024-12-31')).toBe(true);
    expect(inTerm({ effectiveDate: '2024-01-01', termMonths: 12 }, '2025-01-01', '2025-01-31')).toBe(false);
    expect(inTerm({ effectiveDate: '2026-10-01', termMonths: 12 }, null, null)).toBe(true);
  });
});

describe('recoup', () => {
  const alloc = (key: string, payeeId: string, payable: number) => ({ key, payeeId, payableMinor: BigInt(payable) });

  it('takes from the oldest advance first, never more than it has or than the earnings, never from negatives', () => {
    const out = recoup([alloc('1:a', 'a', 6000), alloc('2:a', 'a', -500), alloc('3:a', 'a', 4000)], [
      { id: 'new', payeeId: 'a', remainingMinor: BigInt(3000), createdAt: '2026-03-01' },
      { id: 'old', payeeId: 'a', remainingMinor: BigInt(5000), createdAt: '2026-02-01' },
    ]);
    expect(out.map((r) => [r.key, r.advanceId, Number(r.amountMinor)])).toEqual([
      ['1:a', 'old', 5000], ['1:a', 'new', 1000], ['3:a', 'new', 2000],
    ]);
  });

  it('is per payee and ignores spent advances', () => {
    const out = recoup([alloc('1:b', 'b', 100)], [{ id: 'x', payeeId: 'a', remainingMinor: BigInt(50), createdAt: 'a' }, { id: 'y', payeeId: 'b', remainingMinor: BigInt(0), createdAt: 'a' }]);
    expect(out).toEqual([]);
  });

  it('property: for seeded random runs nothing goes negative and no advance is over-taken', () => {
    let seed = 20261102;
    const next = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let run = 0; run < 200; run++) {
      const allocs = Array.from({ length: 1 + next(8) }, (_, i) => alloc(`${i + 1}:p`, 'p', next(5000) - 800));
      const advs: AdvanceFact[] = Array.from({ length: next(4) }, (_, i) => ({ id: `a${i}`, payeeId: 'p', remainingMinor: BigInt(next(4000)), createdAt: `2026-0${i + 1}-01` }));
      const out = recoup(allocs, advs);
      for (const a of advs) expect(out.filter((r) => r.advanceId === a.id).reduce((s, r) => s + r.amountMinor, BigInt(0)) <= a.remainingMinor).toBe(true);
      for (const al of allocs) {
        const taken = out.filter((r) => r.key === al.key).reduce((s, r) => s + r.amountMinor, BigInt(0));
        expect(taken >= BigInt(0) && taken <= (al.payableMinor > BigInt(0) ? al.payableMinor : BigInt(0))).toBe(true);
      }
    }
  });
});

// ── Golden file ──────────────────────────────────────────────────────────
// A DistroKid-style CSV through the whole pipeline. The expected output is
// committed (__golden__/earnings-run.json); regenerate with UPDATE_GOLDEN=1
// ONLY after re-deriving the numbers by hand (the asserts above hold the key ones).

const CSV = [
  'Reporting Date,Sale Month,Store,Artist,Title,ISRC,UPC,Quantity,Team Percentage,Song/Album,Country of Sale,Songwriter Royalties Withheld,Earnings (USD)',
  '2026-10-01,2026-09,Spotify,Ara,Night Shift,US-ABC-26-00001,,1200,100,Song,US,0,100.01',
  '2026-10-01,2026-09,Apple Music,Ara,Night Shift,,012345678905,10,100,Song,GB,0,1.00',
  '2026-10-01,2026-09,Spotify,Ara,Hidden,US-ABC-26-00002,,5,100,Song,US,0,2.00',
  '2026-10-01,2026-09,Spotify,Ara,Nobody,US-ZZZ-26-00000,,5,100,Song,US,0,3.00',
  '2026-10-01,2026-09,Spotify,Ara,Chargeback,USABC2600001,,0,100,Song,US,0,-2.00',
  '2026-10-01,2026-09,Spotify,Ara,Euro Split,US-ABC-26-00003,,2,100,Song,US,0,4.00',
  '2026-10-01,2026-09,Spotify,Ara,No Code,,,2,100,Song,US,0,0.50',
].join('\n');

const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

describe('golden: CSV → lines → allocation → recoupment', () => {
  const parsed = parseCsv(CSV);
  if (!parsed.ok) throw new Error('fixture');
  const built = buildLines(parsed.header, parsed.rows, { preset: 'auto' });
  if (!built.ok) throw new Error(JSON.stringify(built.failure));
  const run = computeEarnings(built.lines, built.currency, match, alloc, advances);
  const file = join(__dirname, '__golden__', 'earnings-run.json');

  it('matches the committed golden file', () => {
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, JSON.stringify(jsonSafe(run), null, 2) + '\n');
    expect(jsonSafe(run)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });

  it('hand-derived key numbers', () => {
    expect(run.lines.map((l) => [l.lineNo, l.reviewReason])).toEqual([
      [2, null], [3, null], [4, 'no_sheet'], [5, 'no_match'], [6, null], [7, 'currency_mismatch'], [8, 'no_identifier'],
    ]);
    const share = (lineNo: number, p: string) => run.allocations.find((a) => a.lineNo === lineNo && a.partyId === p)?.shareMinor;
    expect([share(2, ARA), share(2, PAT), share(2, BO)]).toEqual([BigInt(5000), BigInt(3334), BigInt(1667)]);
    expect([share(3, ARA), share(3, PAT), share(3, BO)]).toEqual([BigInt(50), BigInt(33), BigInt(17)]);
    expect([share(6, ARA), share(6, PAT), share(6, BO)]).toEqual([BigInt(-100), BigInt(-67), BigInt(-33)]);
    // Ara: line 2 payable 5000 consumes the older advance (5000) exactly; line 3's 50 comes from the newer (3000 → 2950 left).
    expect(run.recoups.map((r) => [r.lineNo, r.payeeId, r.advanceId, Number(r.amountMinor)])).toEqual([
      [2, Y(ARA), 'adv-1', 5000], [2, Y(BO), 'adv-bo', 10], [3, Y(ARA), 'adv-2', 50],
    ]);
    // Conservation: allocated shares of every allocated line add up to the line.
    for (const l of built.lines) {
      const rows = run.allocations.filter((a) => a.lineNo === l.lineNo);
      if (rows.length) expect(rows.reduce((s, a) => s + a.shareMinor, BigInt(0))).toBe(l.grossMinor);
    }
    // Never negative after recoupment.
    for (const a of run.allocations) {
      const taken = run.recoups.filter((r) => r.lineNo === a.lineNo && r.payeeId === a.payeeId).reduce((s, r) => s + r.amountMinor, BigInt(0));
      if (a.payableMinor > BigInt(0)) expect(a.payableMinor - taken >= BigInt(0)).toBe(true);
    }
  });

  it('is deterministic: the same run twice is identical', () => {
    expect(jsonSafe(computeEarnings(built.lines, built.currency, match, alloc, advances))).toEqual(jsonSafe(run));
  });
});
