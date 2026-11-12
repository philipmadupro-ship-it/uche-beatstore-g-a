import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './earnings-csv';
import { buildLines } from './earnings-import';
import {
  allocateLine, chooseRate, computeEarnings, inTerm, matchLine, rateIncomeClass, recoup,
  type AdvanceFact, type AllocFacts, type ContractFact, type MatchFacts, type SheetFact,
} from './earnings-calc';

const S1 = 'song-1', S2 = 'song-2-no-sheet', S3 = 'song-3-eur', S4 = 'song-4-bad-split', S5 = 'song-5-no-payee', S6 = 'song-6-over', S7 = 'song-7-mixed';
const R1 = 'rec-1', R2 = 'rec-2', R3 = 'rec-3', R4 = 'rec-4', R5 = 'rec-5', R6 = 'rec-6', R7 = 'rec-7', RDUP1 = 'rec-dup-a', RDUP2 = 'rec-dup-b', RORPHAN = 'rec-orphan';
const ARA = 'party-ara', PAT = 'party-pat', BO = 'party-bo', EUROS = 'party-euro', NOBODY = 'party-nobody', MAIN = 'party-main';
const Y = (party: string) => `payee-${party}`;

const sheet = (id: string, songId: string, lines: [string, number][], over: Partial<SheetFact> = {}): SheetFact => ({
  id, songId, kind: 'master', status: 'signed', lines: lines.map(([partyId, units], position) => ({ partyId, units, position })), ...over,
});

const match: MatchFacts = {
  recordingsByIsrc: new Map([
    ['USABC2600001', [R1]], ['USABC2600002', [R2]], ['USABC2600003', [R3]], ['USABC2600004', [R4]], ['USABC2600005', [R5]], ['USABC2600006', [R6]], ['USABC2600007', [R7]],
    ['USABC2600099', [RDUP1, RDUP2]], ['USABC2600098', [RORPHAN]],
  ]),
  recordingsByUpc: new Map([['012345678905', [R1]], ['012345678912', [R1, R2]]]),
  songsOf: new Map([[R1, [S1]], [R2, [S2]], [R3, [S3]], [R4, [S4]], [R5, [S5]], [R6, [S6]], [R7, [S7]], [RDUP1, [S1]], [RDUP2, [S1]]]),
};

const patContract: ContractFact = {
  id: 'contract-pat', partyId: PAT, partyRole: 'producer', contractType: 'producer', trackId: S1, releaseId: null, artistContactId: null, rateUnits: 185000, effectiveDate: '2026-01-01', termMonths: 24,
};

const alloc: AllocFacts = {
  sheets: new Map<string, SheetFact[]>([
    [`${S1}:master`, [sheet('sheet-1', S1, [[ARA, 500000], [PAT, 333333], [BO, 166667]])]],
    // S1's COMPOSITION sheet: Ara 50 / Pat 50 (Pat is on both sheets; his rate is a RECORDING rate).
    [`${S1}:composition`, [sheet('sheet-1c', S1, [[ARA, 500000], [PAT, 500000]], { kind: 'composition' })]],
    [`${S3}:master`, [sheet('sheet-3', S3, [[ARA, 600000], [EUROS, 400000]])]],
    [`${S4}:master`, [sheet('sheet-4', S4, [[ARA, 500000], [BO, 400000]])]],
    [`${S5}:master`, [sheet('sheet-5', S5, [[ARA, 500000], [NOBODY, 500000]])]],
    // S6: Ara has 100 % of the sheet AND the main artist has a 40 % contract on this song (not on the sheet): 140 % → review.
    [`${S6}:master`, [sheet('sheet-6', S6, [[ARA, 1000000]])]],
    // S7: Bo on the split, Ara on a contract rate (she is on the sheet at 70 %, the contract replaces it): 30 % + 40 % → paid, label keeps 30 %.
    [`${S7}:master`, [sheet('sheet-7', S7, [[ARA, 700000], [BO, 300000]])]],
  ]),
  payeeByParty: new Map([
    [ARA, { id: Y(ARA), partyId: ARA, currency: 'USD', status: 'active', artistContactId: 'contact-ara' }],
    [PAT, { id: Y(PAT), partyId: PAT, currency: 'USD', status: 'active', artistContactId: null }],
    [BO, { id: Y(BO), partyId: BO, currency: 'USD', status: 'active', artistContactId: 'contact-bo' }],
    [MAIN, { id: Y(MAIN), partyId: MAIN, currency: 'USD', status: 'active', artistContactId: null }],
    [EUROS, { id: Y(EUROS), partyId: EUROS, currency: 'EUR', status: 'active', artistContactId: null }],
  ]),
  contracts: new Map<string, ContractFact[]>([
    [PAT, [patContract]],
    [MAIN, [{ ...patContract, id: 'contract-main', partyId: MAIN, partyRole: 'artist', contractType: 'recording', trackId: S6, rateUnits: 400000 }]],
    [ARA, [{ ...patContract, id: 'contract-ara-s7', partyId: ARA, partyRole: 'artist', contractType: 'recording', trackId: S7, rateUnits: 400000 }]],
  ]),
  releasesOfSong: new Map(),
  // Whose work each song is (inbox / linked contacts of its projects).
  songArtists: new Map([[S1, new Set(['contact-ara'])], [S6, new Set(['contact-ara'])], [S7, new Set(['contact-ara'])]]),
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
  const row = (r: ReturnType<typeof allocateLine>, party: string) => (r.ok ? r.rows.find((x) => x.partyId === party) : undefined);

  it('SPLIT: gross × share by largest remainder; a contract-rate payee is paid gross × rate INSTEAD of their share; the rest is the label’s', () => {
    const r = allocateLine(line(2, 'x', 10001), 'USD', S1, alloc);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.basis, x.units, x.payableMinor])).toEqual([
      [ARA, 'split', 500000, BigInt(5000)],
      [PAT, 'rate', 185000, BigInt(1850)], // 10001 × 18.5 % = 1850.185 → 1850 (NOT 3334 × 18.5 %: no double reduction)
      [BO, 'split', 166667, BigInt(1667)],
    ]);
    expect(r.ok && r.retainedMinor).toBe(BigInt(10001 - 5000 - 1850 - 1667));
    expect(row(r, PAT)?.contractId).toBe('contract-pat');
    expect(row(r, ARA)?.contractId).toBeNull();
  });

  it('SPLIT-ONLY: with no contract the payees add up to the line exactly and the label keeps nothing', () => {
    const noContracts: AllocFacts = { ...alloc, contracts: new Map() };
    const r = allocateLine(line(2, 'x', 10001), 'USD', S1, noContracts);
    expect(r.ok && r.rows.map((x) => x.payableMinor)).toEqual([BigInt(5000), BigInt(3334), BigInt(1667)]);
    expect(r.ok && r.retainedMinor).toBe(BigInt(0));
  });

  it('RATE-ONLY: a payee alone on the sheet with a 40 % contract is paid 40 %; the label keeps 60 %', () => {
    const solo: AllocFacts = { ...alloc, sheets: new Map([[`${S7}:master`, [sheet('s', S7, [[ARA, 1000000]])]]]) };
    const r = allocateLine(line(2, 'x', 1000), 'USD', S7, solo);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.basis, x.payableMinor])).toEqual([[ARA, 'rate', BigInt(400)]]);
    expect(r.ok && r.retainedMinor).toBe(BigInt(600));
  });

  it('MIXED: one payee on a contract rate, the other on the split (50 % of the master and a 40 % royalty is 40 %, not 28 %)', () => {
    const r = allocateLine(line(2, 'x', 1000), 'USD', S7, alloc);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.basis, x.units, x.payableMinor])).toEqual([
      [ARA, 'rate', 400000, BigInt(400)],
      [BO, 'split', 300000, BigInt(300)],
    ]);
    expect(r.ok && r.retainedMinor).toBe(BigInt(300));
  });

  it('OVER 100 %: rates and splits adding up to more than the line pay NOTHING — the line waits as terms_exceed_gross', () => {
    // Ara 100 % of the sheet + MAIN (not on the sheet) 40 % by a song-level contract.
    expect(allocateLine(line(2, 'x', 1000), 'USD', S6, alloc)).toEqual({ ok: false, reason: 'terms_exceed_gross' });
    // Exactly 100 % is fine.
    const exact: AllocFacts = { ...alloc, contracts: new Map([[MAIN, [{ ...patContract, id: 'c', partyId: MAIN, partyRole: 'artist', contractType: 'recording', trackId: S6, rateUnits: 0 }]]]) };
    expect(allocateLine(line(2, 'x', 1000), 'USD', S6, exact)).toMatchObject({ ok: true });
  });

  it('a contract-only payee (song-level, not on the sheet) is paid by rate on top of the sheet; an artist-level deal never reaches a song they are not on', () => {
    const c = (id: string, party: string, over: Partial<ContractFact>): ContractFact => ({ ...patContract, id, partyId: party, partyRole: 'artist', contractType: 'recording', ...over });
    // Sheet Ara 80 / Bo 20; Ara's own 50 % contract REPLACES her 80 %; MAIN (not on the sheet) has a 20 % contract on the song → 50 + 20 + 20 = 90 %.
    const only: AllocFacts = {
      ...alloc,
      sheets: new Map([[`${S6}:master`, [sheet('sheet-6b', S6, [[ARA, 800000], [BO, 200000]])]]]),
      contracts: new Map([[ARA, [c('ca', ARA, { trackId: S6, rateUnits: 500000 })]], [MAIN, [c('cm', MAIN, { trackId: S6, rateUnits: 200000 })]]]),
    };
    const r = allocateLine(line(2, 'x', 1000), 'USD', S6, only);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.basis, x.payableMinor])).toEqual([[ARA, 'rate', BigInt(500)], [BO, 'split', BigInt(200)], [MAIN, 'rate', BigInt(200)]]);
    expect(r.ok && r.retainedMinor).toBe(BigInt(100));
    // An artist-level deal (no song, no release) pays its party on the SONG's artist's songs — even off the sheet — and on no one else's.
    const deal = (artist: string): AllocFacts => ({ ...alloc, sheets: only.sheets, contracts: new Map([[ARA, only.contracts.get(ARA) ?? []], [MAIN, [c('cd', MAIN, { trackId: null, artistContactId: artist, rateUnits: 100000 })]]]) });
    const by = allocateLine(line(2, 'x', 1000), 'USD', S6, deal('contact-ara'));
    expect(by.ok && by.rows.map((x) => x.partyId)).toEqual([ARA, BO, MAIN]);
    const other = allocateLine(line(2, 'x', 1000), 'USD', S6, deal('contact-nobody'));
    expect(other.ok && other.rows.map((x) => x.partyId)).toEqual([ARA, BO]);
  });

  it('receiving role: a feature contract pays the FEATURED artist the rate while the primary artist keeps their split share', () => {
    // S7 sheet: Ara (primary, pays) 70 / Bo (featured) 30. The feature contract names Ara as `artist` and Bo as `featured`.
    const feature = (party: string, role: string): ContractFact => ({ ...patContract, id: `f-${party}`, partyId: party, partyRole: role, contractType: 'feature', trackId: S7, rateUnits: 200000 });
    const facts: AllocFacts = { ...alloc, contracts: new Map([[ARA, [feature(ARA, 'artist')]], [BO, [feature(BO, 'featured')]]]) };
    const r = allocateLine(line(2, 'x', 1000), 'USD', S7, facts);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.basis, x.payableMinor])).toEqual([[ARA, 'split', BigInt(700)], [BO, 'rate', BigInt(200)]]);
    expect(r.ok && r.retainedMinor).toBe(BigInt(100));
  });

  it('receiving role: a producer contract pays the producer; an artist CLIENT on it keeps their split share', () => {
    const prod = (party: string, role: string): ContractFact => ({ ...patContract, id: `p-${party}`, partyId: party, partyRole: role, contractType: 'producer', trackId: S7, rateUnits: 100000 });
    const facts: AllocFacts = { ...alloc, contracts: new Map([[ARA, [prod(ARA, 'client')]], [BO, [prod(BO, 'producer')]]]) };
    const r = allocateLine(line(2, 'x', 1000), 'USD', S7, facts);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.basis, x.payableMinor])).toEqual([[ARA, 'split', BigInt(700)], [BO, 'rate', BigInt(100)]]);
  });

  it('M1: a party who receives a rate on this song but has no payee record sends the line to review — never retained silently', () => {
    const noPayee: AllocFacts = { ...alloc, payeeByParty: new Map([...alloc.payeeByParty].filter(([k]) => k !== MAIN)) };
    // S6: Ara on the sheet, MAIN receives a 40 % recording rate on the song and has no payee.
    expect(allocateLine(line(2, 'x', 1000), 'USD', S6, noPayee)).toEqual({ ok: false, reason: 'no_payee' });
    // A party whose contract does not cover this song is not asked for.
    expect(allocateLine(line(2, 'x', 1000), 'USD', S1, noPayee)).toMatchObject({ ok: true });
  });

  it('H1: a recording (master) rate never touches publishing income — a producer on both sheets keeps their composition share there', () => {
    // PAT: 18.5 % recording rate on S1. Master line → rate. Publishing line → his 50 % composition share, Ara 50 %, nothing retained.
    const master = allocateLine(line(2, 'x', 10001), 'USD', S1, alloc);
    expect(master.ok && master.rows.find((x) => x.partyId === PAT)).toMatchObject({ basis: 'rate', payableMinor: BigInt(1850) });
    const publishing = allocateLine(line(2, 'x', 10001, { incomeClass: 'publishing' }), 'USD', S1, alloc);
    expect(publishing.ok && publishing.rows.map((x) => [x.partyId, x.basis, x.payableMinor])).toEqual([[ARA, 'split', BigInt(5001)], [PAT, 'split', BigInt(5000)]]);
    expect(publishing.ok && publishing.retainedMinor).toBe(BigInt(0));
  });

  it('H1: a master-only contract party is not added to a publishing line (no spurious terms_exceed_gross)', () => {
    // S6 has MAIN's 40 % MASTER contract. A publishing line of S6 needs a composition sheet; MAIN must not appear on it.
    const withComposition: AllocFacts = { ...alloc, sheets: new Map([...alloc.sheets, [`${S6}:composition`, [sheet('sheet-6c', S6, [[ARA, 1000000]], { kind: 'composition' })]]]) };
    const r = allocateLine(line(2, 'x', 1000, { incomeClass: 'publishing' }), 'USD', S6, withComposition);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.basis, x.payableMinor])).toEqual([[ARA, 'split', BigInt(1000)]]);
    // …while the same song's MASTER line is the over-100 % review case.
    expect(allocateLine(line(2, 'x', 1000), 'USD', S6, withComposition)).toEqual({ ok: false, reason: 'terms_exceed_gross' });
  });

  it('allocates a negative line as the mirror of the positive one (a clawback)', () => {
    const r = allocateLine(line(2, 'x', -200), 'USD', S1, alloc);
    expect(r.ok && r.rows.map((x) => x.payableMinor)).toEqual([BigInt(-100), BigInt(-37), BigInt(-33)]); // −200 × 18.5 % = −37
    expect(r.ok && r.retainedMinor).toBe(BigInt(-30));
  });

  it('puts the WHOLE line in review rather than guess', () => {
    expect(allocateLine(line(2, 'x', 100), 'USD', S2, alloc)).toEqual({ ok: false, reason: 'no_sheet' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S4, alloc)).toEqual({ ok: false, reason: 'bad_split' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S5, alloc)).toEqual({ ok: false, reason: 'no_payee' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S3, alloc)).toEqual({ ok: false, reason: 'currency_mismatch' });
    // publishing income needs a COMPOSITION sheet, which S3 does not have.
    expect(allocateLine(line(2, 'x', 100, { incomeClass: 'publishing' }), 'USD', S3, alloc)).toEqual({ ok: false, reason: 'no_sheet' });
  });

  it('ignores a draft or superseded sheet and refuses two live ones', () => {
    const only = (s: SheetFact[]): AllocFacts => ({ ...alloc, contracts: new Map(), sheets: new Map([[`${S1}:master`, s]]) });
    const base = sheet('a', S1, [[ARA, 1000000]]);
    expect(allocateLine(line(2, 'x', 100), 'USD', S1, only([{ ...base, status: 'draft' }]))).toEqual({ ok: false, reason: 'no_sheet' });
    expect(allocateLine(line(2, 'x', 100), 'USD', S1, only([{ ...base, status: 'superseded' }, { ...base, id: 'b', status: 'circulated' }]))).toMatchObject({ ok: true });
    expect(allocateLine(line(2, 'x', 100), 'USD', S1, only([base, { ...base, id: 'b' }]))).toEqual({ ok: false, reason: 'no_sheet' });
  });

  it('merges a party on two rows into one allocation', () => {
    const two: AllocFacts = { ...alloc, contracts: new Map(), sheets: new Map([[`${S1}:master`, [sheet('s', S1, [[ARA, 250000], [BO, 500000], [ARA, 250000]])]]]) };
    const r = allocateLine(line(2, 'x', 1000), 'USD', S1, two);
    expect(r.ok && r.rows.map((x) => [x.partyId, x.payableMinor, x.units])).toEqual([[ARA, BigInt(500), 500000], [BO, BigInt(500), 500000]]);
  });
});

describe('contract rate choice', () => {
  const ctx = { songId: S1, releaseIds: new Set(['rel-1']), songArtistIds: new Set(['contact-ara']), incomeClass: 'master' as const, periodStart: '2026-09-01', periodEnd: '2026-09-30' };
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

  it('an artist-level deal applies to songs BY that artist, not to a song where its party is merely a feature', () => {
    const artistWide = c({ id: 'c-a', trackId: null, artistContactId: 'contact-ara', rateUnits: 100000 });
    expect(chooseRate([artistWide], ctx)).toEqual({ kind: 'rate', contractId: 'c-a', rateUnits: 100000 });
    expect(chooseRate([artistWide], { ...ctx, songArtistIds: new Set(['contact-someone-else']) })).toEqual({ kind: 'none' });
    expect(chooseRate([artistWide], { ...ctx, songArtistIds: new Set() })).toEqual({ kind: 'none' });
  });

  it('a rate applies only to the income class of its contract type, and only to the receiving role', () => {
    const master = c({ id: 'c-m', rateUnits: 100000 }); // producer contract, party role producer: master income
    const publishing = c({ id: 'c-p', rateUnits: 300000, contractType: 'co_publishing', partyRole: 'collaborator' });
    const none = c({ id: 'c-n', rateUnits: 900000, contractType: 'licence', partyRole: 'licensor' });
    expect(chooseRate([master, publishing, none], ctx)).toEqual({ kind: 'rate', contractId: 'c-m', rateUnits: 100000 });
    expect(chooseRate([master, publishing, none], { ...ctx, incomeClass: 'publishing' })).toEqual({ kind: 'rate', contractId: 'c-p', rateUnits: 300000 });
    expect(chooseRate([none], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([none], { ...ctx, incomeClass: 'publishing' })).toEqual({ kind: 'none' });
  });

  it('only the RECEIVING role of the contract type gets the rate (the payer on the same contract keeps their split share)', () => {
    // feature: the featured artist receives, the primary artist who pays does not. producer: the producer, not the artist client.
    expect(chooseRate([c({ contractType: 'feature', partyRole: 'featured' })], ctx)).toMatchObject({ kind: 'rate' });
    expect(chooseRate([c({ contractType: 'feature', partyRole: 'artist' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ contractType: 'producer', partyRole: 'producer' })], ctx)).toMatchObject({ kind: 'rate' });
    expect(chooseRate([c({ contractType: 'producer', partyRole: 'client' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ contractType: 'producer', partyRole: 'artist' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ contractType: 'recording', partyRole: 'artist' })], ctx)).toMatchObject({ kind: 'rate' });
    expect(chooseRate([c({ contractType: 'recording', partyRole: 'label' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ contractType: 'beat_licence', partyRole: 'licensor' })], ctx)).toMatchObject({ kind: 'rate' });
    expect(chooseRate([c({ contractType: 'beat_licence', partyRole: 'licensee' })], ctx)).toEqual({ kind: 'none' });
    expect(chooseRate([c({ contractType: 'co_publishing', partyRole: 'publisher' })], { ...ctx, incomeClass: 'publishing' })).toMatchObject({ kind: 'rate' });
  });

  it('rateIncomeClass: recording-like types are master, co-publishing is publishing, everything else sets no rate', () => {
    for (const t of ['recording', 'feature', 'producer', 'beat_licence', 'distribution', 'deal_360']) expect(rateIncomeClass(t), t).toBe('master');
    expect(rateIncomeClass('co_publishing')).toBe('publishing');
    for (const t of ['licence', 'management', 'nda', 'collaboration', 'session', 'work_for_hire', 'mixing_mastering', 'unknown', '']) expect(rateIncomeClass(t), t).toBeNull();
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
  '2026-10-01,2026-09,Spotify,Ara,Over,US-ABC-26-00006,,2,100,Song,US,0,10.00',
  '2026-10-01,2026-09,Spotify,Ara,Mixed,US-ABC-26-00007,,2,100,Song,US,0,10.00',
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
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(file, JSON.stringify(jsonSafe(run), null, 2) + '\n');
    expect(existsSync(file), `missing golden file ${file}: regenerate with UPDATE_GOLDEN=1 after re-deriving the numbers`).toBe(true);
    expect(jsonSafe(run)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });

  it('hand-derived key numbers', () => {
    expect(run.lines.map((l) => [l.lineNo, l.reviewReason])).toEqual([
      [2, null], [3, null], [4, 'no_sheet'], [5, 'no_match'], [6, null], [7, 'currency_mismatch'], [8, 'no_identifier'], [9, 'terms_exceed_gross'], [10, null],
    ]);
    const paid = (lineNo: number, p: string) => run.allocations.find((a) => a.lineNo === lineNo && a.partyId === p)?.payableMinor;
    // Line 2 (100.01): Ara 50 % split, Pat 18.5 % RATE (not split × rate), Bo split; the label keeps the rest.
    expect([paid(2, ARA), paid(2, PAT), paid(2, BO)]).toEqual([BigInt(5000), BigInt(1850), BigInt(1667)]);
    // Line 3 (1.00): 50 / 18.5 → 18 (half to even) / 17.
    expect([paid(3, ARA), paid(3, PAT), paid(3, BO)]).toEqual([BigInt(50), BigInt(18), BigInt(17)]);
    // Line 6 (−2.00): the mirror.
    expect([paid(6, ARA), paid(6, PAT), paid(6, BO)]).toEqual([BigInt(-100), BigInt(-37), BigInt(-33)]);
    // Line 10 (10.00, mixed): Ara by 40 % contract, Bo by 30 % split.
    expect([paid(10, ARA), paid(10, BO)]).toEqual([BigInt(400), BigInt(300)]);
    // Ara: line 2 payable 5000 consumes the older advance (5000) exactly; line 3's 50 comes from the newer (3000 → 2950 left).
    expect(run.recoups.map((r) => [r.lineNo, r.payeeId, r.advanceId, Number(r.amountMinor)])).toEqual([
      [2, Y(ARA), 'adv-1', 5000], [2, Y(BO), 'adv-bo', 10], [3, Y(ARA), 'adv-2', 50], [10, Y(ARA), 'adv-2', 400],
    ]);
    // Never pay more than was received, and what is left is the label's.
    for (const l of built.lines) {
      const rows = run.allocations.filter((x) => x.lineNo === l.lineNo);
      const total = rows.reduce((sum, x) => sum + x.payableMinor, BigInt(0));
      if (rows.length) expect(total <= l.grossMinor === l.grossMinor >= BigInt(0) || total === l.grossMinor).toBe(true);
      if (rows.length && l.grossMinor > BigInt(0)) expect(total <= l.grossMinor).toBe(true);
    }
    // Never negative after recoupment.
    for (const a of run.allocations) {
      const taken = run.recoups.filter((r) => r.lineNo === a.lineNo && r.payeeId === a.payeeId).reduce((s, r) => s + r.amountMinor, BigInt(0));
      if (a.payableMinor > BigInt(0)) expect(a.payableMinor - taken >= BigInt(0)).toBe(true);
    }
  });

  it('golden (publishing income): a producer on both sheets with a RECORDING rate keeps their composition share; the master-only payees do not appear', () => {
    const lines = built.lines.map((l) => ({ ...l, incomeClass: 'publishing' as const }));
    const publishing = computeEarnings(lines, built.currency, match, alloc, advances);
    const file = join(__dirname, '__golden__', 'earnings-run-publishing.json');
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(file, JSON.stringify(jsonSafe(publishing), null, 2) + '\n');
    expect(existsSync(file), `missing golden file ${file}: regenerate with UPDATE_GOLDEN=1 after re-deriving the numbers`).toBe(true);
    expect(jsonSafe(publishing)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    // Only Night Shift (S1) has a composition sheet. Lines 2 and 3 (gross 100.01 and 1.00): Ara 50 % / Pat 50 %, no rate, nothing retained.
    expect(publishing.allocations.map((a) => [a.lineNo, a.partyId, a.basis, Number(a.payableMinor)])).toEqual([
      [2, ARA, 'split', 5001], [2, PAT, 'split', 5000],
      [3, ARA, 'split', 50], [3, PAT, 'split', 50],
      [6, ARA, 'split', -100], [6, PAT, 'split', -100],
    ]);
    // Everything else has no composition sheet → waits (S6's master-only contract never makes it an over-100 % case here).
    expect(publishing.lines.map((l) => [l.lineNo, l.reviewReason])).toEqual([
      [2, null], [3, null], [4, 'no_sheet'], [5, 'no_match'], [6, null], [7, 'no_sheet'], [8, 'no_identifier'], [9, 'no_sheet'], [10, 'no_sheet'],
    ]);
  });

  it('is deterministic: the same run twice is identical', () => {
    expect(jsonSafe(computeEarnings(built.lines, built.currency, match, alloc, advances))).toEqual(jsonSafe(run));
  });
});
