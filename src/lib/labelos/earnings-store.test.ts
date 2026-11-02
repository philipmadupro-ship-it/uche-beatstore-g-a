/**
 * The earnings store (LABEL-62) against the in-memory database: how facts are
 * read (matching a recording to its song, the split sheet in force, which
 * contracts count, what an advance has left) and how the queue is scoped. The
 * arithmetic is earnings-calc.test.ts; the database's own rules are
 * supabase/local/checks/180_labelos_earnings.sql.
 */
import { describe, expect, it, vi } from 'vitest';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import type { AdminClient } from '@/lib/auth/ownership';
import { calculate, loadAdvances, loadAllocFacts, loadMatchFacts, reprocessImport, visibleReviewLines, type ReviewLine } from './earnings-store';
import type { ParsedLine } from './finance/earnings-import';

vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const ORG = 'org-1';
const admin = (db: MemoryDb) => memoryAdmin(db).client as unknown as AdminClient;

describe('loadMatchFacts', () => {
  const db: MemoryDb = {
    tables: {
      tracks: [
        { id: 'song-1', org_id: ORG, type: 'song', isrc: 'USABC2600001' },
        { id: 'master-2', org_id: ORG, type: 'master', isrc: 'USABC2600002' },
        { id: 'master-3', org_id: ORG, type: 'master', isrc: 'USABC2600003' },
        { id: 'song-2', org_id: ORG, type: 'song', isrc: null },
        { id: 'song-3', org_id: ORG, type: 'song', isrc: null },
        { id: 'other-org', org_id: 'org-2', type: 'song', isrc: 'USABC2600001' },
      ],
      releases: [{ id: 'rel-1', org_id: ORG, upc: '012345678905' }],
      release_items: [
        { release_id: 'rel-1', org_id: ORG, position: 1, song_track_id: 'song-2', master_track_id: 'master-2' },
        { release_id: 'rel-x', org_id: ORG, position: 1, song_track_id: 'song-3', master_track_id: 'master-3' },
      ],
      track_links: [{ from_track_id: 'song-3', to_track_id: 'master-3', relation: 'master' }],
    },
  };

  it('maps an ISRC to the org recording and its song (itself, a release item’s master, or a linked master); never another org’s', async () => {
    const f = await loadMatchFacts(admin(db), ORG, ['USABC2600001', 'USABC2600002', 'USABC2600003'], ['012345678905']);
    expect(f.recordingsByIsrc.get('USABC2600001')).toEqual(['song-1']);
    expect(f.songsOf.get('song-1')).toEqual(['song-1']);
    expect(f.songsOf.get('master-2')).toEqual(['song-2']);
    expect(f.songsOf.get('master-3')).toEqual(['song-3']);
    expect(f.recordingsByUpc.get('012345678905')).toEqual(['master-2']);
  });
});

describe('loadAdvances', () => {
  it('returns only live recoupable advances, less what was already recouped', async () => {
    const db: MemoryDb = {
      tables: {
        advances: [
          { id: 'a1', org_id: ORG, payee_id: 'p1', kind: 'recoupable', amount_minor: 5000, created_at: '2026-01-01', voided_at: null },
          { id: 'a2', org_id: ORG, payee_id: 'p1', kind: 'non_recoupable', amount_minor: 900, created_at: '2026-01-02', voided_at: null },
          { id: 'a3', org_id: ORG, payee_id: 'p1', kind: 'recoupable', amount_minor: 700, created_at: '2026-01-03', voided_at: '2026-02-01' },
        ],
        earnings_recoupments: [{ org_id: ORG, advance_id: 'a1', amount_minor: 1200 }, { org_id: ORG, advance_id: 'a1', amount_minor: 300 }],
      },
    };
    expect(await loadAdvances(admin(db), ORG)).toEqual([{ id: 'a1', payeeId: 'p1', remainingMinor: BigInt(3500), createdAt: '2026-01-01' }]);
  });
});

describe('loadAllocFacts', () => {
  const party = (id: string) => ({ org_id: ORG, id });
  const base = (): MemoryDb => ({
    tables: {
      payees: [{ id: 'py-1', org_id: ORG, party_id: 'party-1', currency: 'USD', status: 'active', artist_contact_id: 'c1' }],
      split_sheets: [
        { id: 'sh-1', org_id: ORG, track_id: 'song-1', kind: 'master', status: 'signed' },
        { id: 'sh-draft', org_id: ORG, track_id: 'song-1', kind: 'composition', status: 'draft' },
        { id: 'sh-old', org_id: ORG, track_id: 'song-1', kind: 'master', status: 'superseded' },
      ],
      split_lines: [
        { split_sheet_id: 'sh-1', org_id: ORG, party_id: 'party-1', share: 33.3333, position: 0, id: 'l1' },
        { split_sheet_id: 'sh-1', org_id: ORG, party_id: 'party-2', share: 66.6667, position: 1, id: 'l2' },
      ],
      release_items: [{ release_id: 'rel-1', org_id: ORG, song_track_id: 'song-1' }],
      contracts: [
        { id: 'ct-ok', type: 'recording', org_id: ORG, status: 'signed', track_id: 'song-1', release_id: null, artist_contact_id: null, effective_date: '2026-01-01', term_months: 24, fields: { royalty_rate: '18.5' }, sent_document_sha256: 'h1' },
        { id: 'ct-stale', type: 'recording', org_id: ORG, status: 'signed', track_id: 'song-1', release_id: null, artist_contact_id: null, effective_date: null, term_months: null, fields: { royalty_rate: '50' }, sent_document_sha256: 'h2' },
        { id: 'ct-norate', type: 'recording', org_id: ORG, status: 'signed', track_id: 'song-1', release_id: null, artist_contact_id: null, effective_date: null, term_months: null, fields: {}, sent_document_sha256: 'h3' },
        { id: 'ct-draft', type: 'recording', org_id: ORG, status: 'draft', track_id: 'song-1', release_id: null, artist_contact_id: null, effective_date: null, term_months: null, fields: { royalty_rate: '70' }, sent_document_sha256: null },
      ],
      contract_parties: [
        { contract_id: 'ct-ok', org_id: ORG, party_id: 'party-1', role: 'artist', position: 0 },
        { contract_id: 'ct-ok', org_id: ORG, party_id: 'party-9', role: 'label', position: 1 },
        { contract_id: 'ct-stale', org_id: ORG, party_id: 'party-1', role: 'artist', position: 0 },
        { contract_id: 'ct-norate', org_id: ORG, party_id: 'party-1', role: 'artist', position: 0 },
      ],
      contract_signatures: [
        { id: 's1', contract_id: 'ct-ok', org_id: ORG, party_id: 'party-1', role: 'artist', contract_version: 1, document_sha256: 'h1', signed_at: '2026-01-02' },
        { id: 's2', contract_id: 'ct-ok', org_id: ORG, party_id: 'party-9', role: 'label', contract_version: 1, document_sha256: 'h1', signed_at: '2026-01-03' },
        // signed an OLDER document: stale, so the contract does not count even though its status says signed
        { id: 's3', contract_id: 'ct-stale', org_id: ORG, party_id: 'party-1', role: 'artist', contract_version: 1, document_sha256: 'old', signed_at: '2026-01-02' },
      ],
      parties: [party('party-1'), party('party-2')],
    },
  });

  it('reads the live sheets (not drafts or superseded), exact share units, the payees, the releases of a song', async () => {
    const f = await loadAllocFacts(admin(base()), ORG, ['song-1']);
    expect(f.sheets.get('song-1:master')).toEqual([{ id: 'sh-1', songId: 'song-1', kind: 'master', status: 'signed', lines: [{ partyId: 'party-1', units: 333333, position: 0 }, { partyId: 'party-2', units: 666667, position: 1 }] }]);
    expect(f.sheets.has('song-1:composition')).toBe(false);
    expect(f.payeeByParty.get('party-1')).toMatchObject({ id: 'py-1', currency: 'USD', artistContactId: 'c1' });
    expect([...(f.releasesOfSong.get('song-1') ?? [])]).toEqual(['rel-1']);
  });

  it('counts only a signed contract whose signatures are valid for the frozen document and that carries a rate', async () => {
    const f = await loadAllocFacts(admin(base()), ORG, ['song-1']);
    expect(f.contracts.get('party-1')).toEqual([
      { id: 'ct-ok', partyId: 'party-1', partyRole: 'artist', trackId: 'song-1', releaseId: null, artistContactId: null, rateUnits: 185000, contractType: 'recording', effectiveDate: '2026-01-01', termMonths: 24 },
    ]);
  });

  it('a signer who has not signed makes the contract not count', async () => {
    const db = base();
    db.tables.contract_signatures = db.tables.contract_signatures.filter((s) => s.id !== 's2');
    const f = await loadAllocFacts(admin(db), ORG, ['song-1']);
    expect(f.contracts.get('party-1') ?? []).toEqual([]);
  });
});

describe('contract kinds and who they pay (real facts, through calculate)', () => {
  const sig = (contract: string, party: string, role: string, sha: string) => ({ id: `s-${contract}-${party}`, contract_id: contract, org_id: ORG, party_id: party, role, contract_version: 1, document_sha256: sha, signed_at: '2026-01-02' });
  const line = (isrc: string, over: Partial<ParsedLine> = {}): ParsedLine => ({
    lineNo: 2, isrc, upc: null, title: null, store: null, territory: null, units: null, grossMinor: BigInt(1000), periodStart: '2026-09-01', periodEnd: '2026-09-30', incomeClass: 'master', ...over,
  });
  const base = (): MemoryDb => ({
    tables: {
      tracks: [{ id: 'song-1', org_id: ORG, type: 'song', isrc: 'USABC2600001' }],
      payees: [
        { id: 'py-ara', org_id: ORG, party_id: 'p-ara', currency: 'USD', status: 'active', artist_contact_id: 'c-ara' },
        { id: 'py-main', org_id: ORG, party_id: 'p-main', currency: 'USD', status: 'active', artist_contact_id: 'c-main' },
      ],
      split_sheets: [{ id: 'sh-1', org_id: ORG, track_id: 'song-1', kind: 'master', status: 'signed' }],
      split_lines: [{ split_sheet_id: 'sh-1', org_id: ORG, party_id: 'p-ara', share: 100, position: 0, id: 'l1' }],
      projects: [{ id: 'pr-1', org_id: ORG, inbox_for_contact_id: 'c-ara' }],
      project_tracks: [{ project_id: 'pr-1', track_id: 'song-1' }],
      project_contacts: [],
      contracts: [{ id: 'ct-main', type: 'recording', org_id: ORG, status: 'signed', track_id: 'song-1', release_id: null, artist_contact_id: null, effective_date: null, term_months: null, fields: { royalty_rate: '40' }, sent_document_sha256: 'h' }],
      contract_parties: [{ contract_id: 'ct-main', org_id: ORG, party_id: 'p-main', role: 'artist', position: 0 }],
      contract_signatures: [sig('ct-main', 'p-main', 'artist', 'h')],
      advances: [], earnings_recoupments: [], releases: [], release_items: [], track_links: [], parties: [],
    },
  });

  it('M1: a signed contract for a party who is on NO sheet is loaded from the store — 100 % sheet + 40 % contract is the over-100 % review case', async () => {
    const run = await calculate(admin(base()), ORG, 'USD', [line('USABC2600001')]);
    expect(run.lines[0]).toMatchObject({ trackId: 'song-1', songId: 'song-1', reviewReason: 'terms_exceed_gross' });
    expect(run.allocations).toEqual([]);
  });

  /** Ara 60 / Other 40 on the sheet; Ara's own 30 % song contract replaces her 60 %, leaving room for a contract-only payee. */
  const roomy = (): MemoryDb => {
    const db = base();
    db.tables.split_lines = [{ split_sheet_id: 'sh-1', org_id: ORG, party_id: 'p-ara', share: 60, position: 0, id: 'l1' }, { split_sheet_id: 'sh-1', org_id: ORG, party_id: 'p-other', share: 40, position: 1, id: 'l2' }];
    db.tables.payees.push({ id: 'py-other', org_id: ORG, party_id: 'p-other', currency: 'USD', status: 'active', artist_contact_id: null });
    db.tables.contracts.push({ id: 'ct-ara', type: 'recording', org_id: ORG, status: 'signed', track_id: 'song-1', release_id: null, artist_contact_id: null, effective_date: null, term_months: null, fields: { royalty_rate: '30' }, sent_document_sha256: 'ha' });
    db.tables.contract_parties.push({ contract_id: 'ct-ara', org_id: ORG, party_id: 'p-ara', role: 'artist', position: 0 });
    db.tables.contract_signatures.push(sig('ct-ara', 'p-ara', 'artist', 'ha'));
    db.tables.contracts[0].fields = { royalty_rate: '20' };
    return db;
  };

  it('M1: when the sheet leaves room, the contract-only payee is paid by rate and the label keeps the rest', async () => {
    const run = await calculate(admin(roomy()), ORG, 'USD', [line('USABC2600001')]);
    expect(run.allocations.map((a) => [a.payeeId, a.basis, Number(a.payableMinor)])).toEqual([['py-ara', 'rate', 300], ['py-other', 'split', 400], ['py-main', 'rate', 200]]);
  });

  it('H1: a recording contract does not apply to publishing income, and a co-publishing contract does', async () => {
    const db = base();
    db.tables.split_sheets.push({ id: 'sh-c', org_id: ORG, track_id: 'song-1', kind: 'composition', status: 'signed' });
    db.tables.split_lines.push({ split_sheet_id: 'sh-c', org_id: ORG, party_id: 'p-ara', share: 100, position: 0, id: 'lc' });
    const publishing = await calculate(admin(db), ORG, 'USD', [line('USABC2600001', { incomeClass: 'publishing' })]);
    // The recording contract of p-main is not for publishing income: only Ara's composition share.
    expect(publishing.allocations.map((a) => [a.payeeId, a.basis, Number(a.payableMinor)])).toEqual([['py-ara', 'split', 1000]]);
    // Re-typed as co-publishing it IS for publishing income: Ara 100 % + main 40 % is the over-100 % case.
    db.tables.contracts[0].type = 'co_publishing';
    db.tables.contract_parties[0].role = 'collaborator'; // the co-writing template's receiving role (the `artist` role is not one)
    const co = await calculate(admin(db), ORG, 'USD', [line('USABC2600001', { incomeClass: 'publishing' })]);
    expect(co.lines[0].reviewReason).toBe('terms_exceed_gross');
    // …and it no longer touches master income.
    const master = await calculate(admin(db), ORG, 'USD', [line('USABC2600001')]);
    expect(master.allocations.map((x) => x.payeeId)).toEqual(['py-ara']);
  });

  it('a contract type that carries no rate (a licence, management, an NDA) is never loaded', async () => {
    const db = base();
    db.tables.contracts[0].type = 'management';
    db.tables.split_lines[0].share = 60;
    db.tables.split_lines.push({ split_sheet_id: 'sh-1', org_id: ORG, party_id: 'p-ara', share: 40, position: 1, id: 'l2' });
    const run = await calculate(admin(db), ORG, 'USD', [line('USABC2600001')]);
    expect(run.allocations.map((a) => a.payeeId)).toEqual(['py-ara']);
  });

  it('M1: a receiving party with NO payee record sends the line to review as no_payee — it is never retained silently', async () => {
    const db = roomy();
    db.tables.payees = db.tables.payees.filter((p) => p.party_id !== 'p-main');
    const run = await calculate(admin(db), ORG, 'USD', [line('USABC2600001')]);
    expect(run.lines[0].reviewReason).toBe('no_payee');
    expect(run.allocations).toEqual([]);
  });

  it('M2: an artist-level deal pays its party on songs whose own artist (the Inbox project’s) it names — and only those', async () => {
    const db = roomy();
    db.tables.contracts[0] = { ...db.tables.contracts[0], track_id: null, artist_contact_id: 'c-ara', fields: { royalty_rate: '10' } };
    const byAra = await calculate(admin(db), ORG, 'USD', [line('USABC2600001')]);
    expect(byAra.allocations.map((a) => [a.payeeId, a.basis, Number(a.payableMinor)])).toEqual([['py-ara', 'rate', 300], ['py-other', 'split', 400], ['py-main', 'rate', 100]]);
    // The same song, now the work of someone else: the deal does not reach it.
    db.tables.projects[0].inbox_for_contact_id = 'c-someone-else';
    const elsewhere = await calculate(admin(db), ORG, 'USD', [line('USABC2600001')]);
    expect(elsewhere.allocations.map((a) => a.payeeId)).toEqual(['py-ara', 'py-other']);
  });

  it('M2: a contact merely LINKED to the project (a feature, an A&R contact) is not the song’s artist, and a joint project does not cross-apply', async () => {
    const db = roomy();
    db.tables.contracts[0] = { ...db.tables.contracts[0], track_id: null, artist_contact_id: 'c-feature', fields: { royalty_rate: '10' } };
    // c-ara owns the Inbox; c-feature is only linked to the project.
    db.tables.project_contacts.push({ project_id: 'pr-1', contact_id: 'c-feature' }, { project_id: 'pr-1', contact_id: 'c-ara' });
    const run = await calculate(admin(db), ORG, 'USD', [line('USABC2600001')]);
    expect(run.allocations.map((a) => a.payeeId)).toEqual(['py-ara', 'py-other']);
    // A second Inbox (a joint project): each artist's deal applies only to a song in THEIR own Inbox.
    db.tables.projects.push({ id: 'pr-2', org_id: ORG, inbox_for_contact_id: 'c-feature' });
    db.tables.project_tracks.push({ project_id: 'pr-2', track_id: 'song-1' });
    const both = await calculate(admin(db), ORG, 'USD', [line('USABC2600001')]);
    expect(both.allocations.map((a) => a.payeeId)).toEqual(['py-ara', 'py-other', 'py-main']);
  });
});

describe('visibleReviewLines', () => {
  const line = (id: string, track: string | null, song: string | null): ReviewLine => ({
    id, import_id: 'i', line_no: 2, isrc: null, upc: null, title: null, store: null, territory: null, gross_minor: 1, currency: 'USD',
    track_id: track, song_track_id: song, income_class: 'master', review_reason: 'no_sheet', period_start: null, period_end: null,
  });
  const lines = [line('unmatched', null, null), line('mine', 'rec-a', 'song-a'), line('theirs', 'rec-b', 'song-b'), line('rec-only', 'song-a', null)];

  it('a whole-org reader sees everything', () => {
    expect(visibleReviewLines(lines, null, null).map((l) => l.id)).toEqual(['unmatched', 'mine', 'theirs', 'rec-only']);
  });
  it('a scoped member sees only lines whose recording or song is in scope: not the unmatched, not another artist’s', () => {
    expect(visibleReviewLines(lines, new Set(['c1']), new Set(['song-a'])).map((l) => l.id)).toEqual(['mine', 'rec-only']);
    expect(visibleReviewLines(lines, new Set(['c1']), new Set()).map((l) => l.id)).toEqual([]);
    expect(visibleReviewLines(lines, new Set(['c1']), null).map((l) => l.id)).toEqual([]);
  });
});

describe('reprocessImport', () => {
  it('re-runs waiting lines through the resolve function and reports what moved', async () => {
    const db: MemoryDb = {
      tables: {
        payees: [{ id: 'py-1', org_id: ORG, party_id: 'party-1', currency: 'USD', status: 'active', artist_contact_id: null }],
        earnings_allocations: [], earnings_imports: [{ id: 'imp-1', org_id: ORG, currency: 'USD' }], earnings_lines: [],
        tracks: [{ id: 'song-1', org_id: ORG, type: 'song', isrc: 'USABC2600001' }],
        split_sheets: [{ id: 'sh-1', org_id: ORG, track_id: 'song-1', kind: 'master', status: 'circulated' }],
        split_lines: [{ split_sheet_id: 'sh-1', org_id: ORG, party_id: 'party-1', share: 100, position: 0, id: 'l1' }],
        advances: [], earnings_recoupments: [], releases: [], release_items: [], track_links: [], contracts: [], contract_parties: [], contract_signatures: [],
      },
      rpc: {
        labelos_earnings_resolve: (args) => {
          expect((args.p_lines as { line_id: string; review_reason: string | null }[]).map((l) => [l.line_id, l.review_reason])).toEqual([['line-a', null], ['line-b', 'no_match']]);
          expect(args.p_allocs).toHaveLength(1);
          return { data: null, error: null };
        },
      },
    };
    const waiting: ReviewLine[] = [
      { id: 'line-a', import_id: 'imp-1', line_no: 2, isrc: 'USABC2600001', upc: null, title: null, store: null, territory: null, gross_minor: 1000, currency: 'USD', track_id: null, song_track_id: null, income_class: 'master', review_reason: 'no_sheet', period_start: null, period_end: null },
      { id: 'line-b', import_id: 'imp-1', line_no: 3, isrc: 'USZZZ0000000', upc: null, title: null, store: null, territory: null, gross_minor: 5, currency: 'USD', track_id: null, song_track_id: null, income_class: 'master', review_reason: 'no_match', period_start: null, period_end: null },
    ];
    expect(await reprocessImport(admin(db), ORG, 'imp-1', waiting)).toEqual({ ok: true, resolved: 1, stillWaiting: 1 });
  });

  it('keeps the line’s period end on a re-run, so a contract that starts later still does not apply', async () => {
    const db: MemoryDb = {
      tables: {
        payees: [{ id: 'py-1', org_id: ORG, party_id: 'party-1', currency: 'USD', status: 'active', artist_contact_id: null }],
        earnings_imports: [{ id: 'imp-1', org_id: ORG, currency: 'USD' }], earnings_lines: [], earnings_allocations: [],
        tracks: [{ id: 'song-1', org_id: ORG, type: 'song', isrc: 'USABC2600001' }],
        split_sheets: [{ id: 'sh-1', org_id: ORG, track_id: 'song-1', kind: 'master', status: 'circulated' }],
        split_lines: [{ split_sheet_id: 'sh-1', org_id: ORG, party_id: 'party-1', share: 100, position: 0, id: 'l1' }],
        contracts: [{ id: 'ct-1', type: 'recording', org_id: ORG, status: 'signed', track_id: 'song-1', release_id: null, artist_contact_id: null, effective_date: '2026-03-01', term_months: null, fields: { royalty_rate: '50' }, sent_document_sha256: 'h1' }],
        contract_parties: [{ contract_id: 'ct-1', org_id: ORG, party_id: 'party-1', role: 'artist', position: 0 }],
        contract_signatures: [{ id: 's1', contract_id: 'ct-1', org_id: ORG, party_id: 'party-1', role: 'artist', contract_version: 1, document_sha256: 'h1', signed_at: '2026-03-02' }],
        advances: [], earnings_recoupments: [], releases: [], release_items: [], track_links: [],
      },
      rpc: {
        labelos_earnings_resolve: (args) => {
          // January earnings, contract effective in March: the split sheet alone decides (100 %), not the 50 % rate.
          expect(args.p_allocs).toMatchObject([{ payable_minor: '1000', basis: 'split', units: 1000000, contract_id: null }]);
          return { data: null, error: null };
        },
      },
    };
    const waiting: ReviewLine[] = [{ id: 'line-a', import_id: 'imp-1', line_no: 2, isrc: 'USABC2600001', upc: null, title: null, store: null, territory: null, gross_minor: 1000, currency: 'USD', track_id: null, song_track_id: null, income_class: 'master', review_reason: 'no_sheet', period_start: '2026-01-01', period_end: '2026-01-31' }];
    expect(await reprocessImport(admin(db), ORG, 'imp-1', waiting)).toEqual({ ok: true, resolved: 1, stillWaiting: 0 });
  });

  it('turns a database serialization failure into a retryable conflict, never a 500', async () => {
    const db: MemoryDb = {
      tables: {
        payees: [], earnings_allocations: [], earnings_imports: [{ id: 'imp-1', org_id: ORG, currency: 'USD' }], earnings_lines: [], tracks: [], split_sheets: [], split_lines: [],
        advances: [], earnings_recoupments: [], releases: [], release_items: [], track_links: [], contracts: [], contract_parties: [], contract_signatures: [],
      },
      rpc: { labelos_earnings_resolve: () => ({ data: null, error: { message: 'earnings: line_not_waiting', code: '40001' } }) },
    };
    const waiting: ReviewLine[] = [{ id: 'line-a', import_id: 'imp-1', line_no: 2, isrc: null, upc: null, title: null, store: null, territory: null, gross_minor: 1, currency: 'USD', track_id: null, song_track_id: null, income_class: 'master', review_reason: 'no_identifier', period_start: null, period_end: null }];
    expect(await reprocessImport(admin(db), ORG, 'imp-1', waiting)).toMatchObject({ ok: false, code: 'recoup_conflict' });
  });
});
