/**
 * The reads and writes behind the earnings routes (LABEL-62). Rules are in
 * `finance/earnings-*.ts`; this file loads the facts they need, hands the
 * result to ONE Postgres function (migration 180) and reads the queue back.
 * Service-role client, org filter on every query; authorisation is the route's.
 *
 * Migrations 179 and 180 may not be applied: a missing table or function is
 * `EarningsNotReadyError` (GET: `schemaReady: false`; writes: 503 naming 180).
 * PostgREST answers an INSERT into a missing table with an empty 404, so every
 * write probes with a read first (`assertEarningsSchema`).
 *
 * Every read is paged and every id list chunked (`paged-read.ts`).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { parseShare } from './splits';
import { requiredSigners, signerStates, signingProgress, type SignatureFact } from './contract-signing';
import type { PartyRole } from './contracts/types';
import { inChunks, pageAll, ReadError } from './paged-read';
import type { ArtistScope } from './artist-scope';
import type { AdvanceFact, AllocFacts, ContractFact, MatchFacts, PayeeFact, ReviewReason, RunResult, SheetFact } from './finance/earnings-calc';
import { computeEarnings } from './finance/earnings-calc';
import type { ParsedLine } from './finance/earnings-import';
import { minorFromDb } from './finance/money';

export const EARNINGS_NOT_READY = 'Earnings are not set up on this database yet (migrations 179 and 180).';

export class EarningsNotReadyError extends Error {
  constructor() {
    super('migrations 179 / 180 are not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

function isMissing(error: DbError): boolean {
  if (!error) return false;
  // A missing relation or function only: a missing COLUMN is a bug (or another migration), never "not set up".
  return ['PGRST205', '42P01', 'PGRST202', '42883'].includes(error.code ?? '');
}

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissing(error)) throw new EarningsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

async function guarded<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ReadError) check(err.message, err.raw as DbError);
    throw err;
  }
}

/**
 * A read that names columns migration 180 adds to a 179 table: 179 applied without 180 answers 42703
 * (undefined column), which for THESE columns means "not set up yet", not a bug.
 */
async function guardedColumns<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await guarded(read);
  } catch (err) {
    if (err instanceof Error && /column .* does not exist|undefined_column|42703/i.test(err.message)) throw new EarningsNotReadyError();
    throw err;
  }
}

export async function assertEarningsSchema(admin: AdminClient): Promise<void> {
  check('allocations probe', (await admin.from('earnings_allocations').select('id').limit(1)).error);
  check('lines probe', (await admin.from('earnings_lines').select('review_reason').limit(1)).error);
}

// ── Facts ────────────────────────────────────────────────────────────────

const uniq = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

export async function loadMatchFacts(admin: AdminClient, orgId: string, isrcs: readonly string[], upcs: readonly string[]): Promise<MatchFacts> {
  const recordingsByIsrc = new Map<string, string[]>();
  const recordingsByUpc = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, uniq([...(m.get(k) ?? []), v]));

  const tracks = await guarded(() =>
    inChunks<{ id: string; isrc: string | null; type: string | null }>(
      isrcs,
      (part, from, to) => admin.from('tracks').select('id, isrc, type').eq('org_id', orgId).in('isrc', part).order('id').range(from, to),
      'tracks by isrc',
    ),
  );
  for (const t of tracks) if (t.isrc) push(recordingsByIsrc, t.isrc.replace(/-/g, '').toUpperCase(), t.id);

  const releases = await guarded(() =>
    inChunks<{ id: string; upc: string | null }>(
      upcs,
      (part, from, to) => admin.from('releases').select('id, upc').eq('org_id', orgId).in('upc', part).order('id').range(from, to),
      'releases by upc',
    ),
  );
  const upcOfRelease = new Map(releases.map((r) => [r.id, r.upc as string]));
  const itemsOfUpc = await guarded(() =>
    inChunks<{ release_id: string; song_track_id: string; master_track_id: string }>(
      releases.map((r) => r.id),
      (part, from, to) =>
        admin.from('release_items').select('release_id, song_track_id, master_track_id').eq('org_id', orgId).in('release_id', part).order('release_id').order('position').range(from, to),
      'release items by release',
    ),
  );
  for (const it of itemsOfUpc) {
    const upc = upcOfRelease.get(it.release_id);
    if (upc) push(recordingsByUpc, upc, it.master_track_id);
  }

  // Recording → song(s): itself when it is a song, a release item's master, a song's linked master.
  const recordings = uniq([...recordingsByIsrc.values(), ...recordingsByUpc.values()].flat());
  const songsOf = new Map<string, string[]>();
  const add = (rec: string, song: string) => songsOf.set(rec, uniq([...(songsOf.get(rec) ?? []), song]));
  const types = await guarded(() =>
    inChunks<{ id: string; type: string | null }>(
      recordings,
      (part, from, to) => admin.from('tracks').select('id, type').eq('org_id', orgId).in('id', part).order('id').range(from, to),
      'recording types',
    ),
  );
  for (const t of types) if (t.type === 'song') add(t.id, t.id);
  const viaItems = await guarded(() =>
    inChunks<{ song_track_id: string; master_track_id: string }>(
      recordings,
      (part, from, to) => admin.from('release_items').select('song_track_id, master_track_id').eq('org_id', orgId).in('master_track_id', part).order('master_track_id').order('release_id').range(from, to),
      'release items by master',
    ),
  );
  for (const it of viaItems) add(it.master_track_id, it.song_track_id);
  const viaLinks = await guarded(() =>
    inChunks<{ from_track_id: string; to_track_id: string }>(
      recordings,
      (part, from, to) =>
        admin.from('track_links').select('from_track_id, to_track_id').eq('relation', 'master').in('to_track_id', part).order('to_track_id').order('from_track_id').range(from, to),
      'master links',
    ),
  );
  // A link row is org-bound by migration 142's trigger; the song must also be this org's.
  const linkSongs = uniq(viaLinks.map((l) => l.from_track_id));
  const inOrg = new Set(
    (await guarded(() =>
      inChunks<{ id: string }>(
        linkSongs,
        (part, from, to) => admin.from('tracks').select('id').eq('org_id', orgId).eq('type', 'song').in('id', part).order('id').range(from, to),
        'linked songs',
      ),
    )).map((t) => t.id),
  );
  for (const l of viaLinks) if (inOrg.has(l.from_track_id)) add(l.to_track_id, l.from_track_id);
  return { recordingsByIsrc, recordingsByUpc, songsOf };
}

type RawContract = {
  id: string;
  track_id: string | null;
  release_id: string | null;
  artist_contact_id: string | null;
  effective_date: string | null;
  term_months: number | null;
  fields: Record<string, unknown> | null;
  sent_document_sha256: string | null;
};

/**
 * Signed contracts that carry a royalty rate AND whose signatures are valid
 * for the frozen document (the database moves a contract to `signed` only when
 * every signer has signed that document; this re-checks it, so a stale
 * signature never sets a rate).
 */
async function loadContractFacts(admin: AdminClient, orgId: string, partyIds: ReadonlySet<string>): Promise<ReadonlyMap<string, ContractFact[]>> {
  const out = new Map<string, ContractFact[]>();
  if (partyIds.size === 0) return out;
  let contracts: RawContract[];
  try {
    contracts = await guarded(() =>
      pageAll<RawContract>(
        (from, to) =>
          admin
            .from('contracts')
            .select('id, track_id, release_id, artist_contact_id, effective_date, term_months, fields, sent_document_sha256')
            .eq('org_id', orgId)
            .eq('status', 'signed')
            .order('id')
            .range(from, to),
        'signed contracts',
      ),
    );
  } catch (err) {
    // Contracts (176/178) not applied: no contract sets a rate, the split sheets alone decide.
    if (err instanceof EarningsNotReadyError) return out;
    throw err;
  }
  const rated = contracts.filter((c) => c.sent_document_sha256 && parseShare(typeof c.fields?.royalty_rate === 'string' ? (c.fields.royalty_rate as string) : null) !== null);
  if (rated.length === 0) return out;
  const ids = rated.map((c) => c.id);
  const [links, sigs] = await Promise.all([
    guarded(() =>
      inChunks<{ contract_id: string; party_id: string; role: PartyRole; position: number }>(
        ids,
        (part, from, to) => admin.from('contract_parties').select('contract_id, party_id, role, position').eq('org_id', orgId).in('contract_id', part).order('contract_id').order('party_id').order('role').range(from, to),
        'contract parties',
      ),
    ),
    guarded(() =>
      inChunks<{ id: string; contract_id: string; party_id: string; role: string; contract_version: number; document_sha256: string; signed_at: string }>(
        ids,
        (part, from, to) =>
          admin.from('contract_signatures').select('id, contract_id, party_id, role, contract_version, document_sha256, signed_at').eq('org_id', orgId).in('contract_id', part).order('contract_id').order('id').range(from, to),
        'contract signatures',
      ),
    ),
  ]);
  const linksOf = new Map<string, typeof links>();
  for (const l of links) linksOf.set(l.contract_id, [...(linksOf.get(l.contract_id) ?? []), l]);
  const sigsOf = new Map<string, SignatureFact[]>();
  for (const s of sigs) {
    sigsOf.set(s.contract_id, [...(sigsOf.get(s.contract_id) ?? []), { id: s.id, partyId: s.party_id, role: s.role, documentSha256: s.document_sha256, contractVersion: s.contract_version, signedAt: s.signed_at }]);
  }
  for (const c of rated) {
    const mine = linksOf.get(c.id) ?? [];
    const facts = sigsOf.get(c.id) ?? [];
    const progress = signingProgress(signerStates(requiredSigners(mine), facts, c.sent_document_sha256 as string));
    if (!progress.complete) continue;
    const rateUnits = parseShare(c.fields?.royalty_rate as string) as number;
    for (const l of mine) {
      if (!partyIds.has(l.party_id)) continue;
      out.set(l.party_id, [
        ...(out.get(l.party_id) ?? []),
        {
          id: c.id, partyId: l.party_id, partyRole: l.role, trackId: c.track_id, releaseId: c.release_id, artistContactId: c.artist_contact_id,
          rateUnits, effectiveDate: c.effective_date, termMonths: c.term_months,
        },
      ]);
    }
  }
  return out;
}

export async function loadAllocFacts(admin: AdminClient, orgId: string, songIds: readonly string[]): Promise<AllocFacts> {
  const payees = await guarded(() =>
    pageAll<{ id: string; party_id: string; currency: string; status: string; artist_contact_id: string | null }>(
      (from, to) => admin.from('payees').select('id, party_id, currency, status, artist_contact_id').eq('org_id', orgId).order('id').range(from, to),
      'payees',
    ),
  );
  const payeeByParty = new Map<string, PayeeFact>(
    payees.map((p) => [p.party_id, { id: p.id, partyId: p.party_id, currency: p.currency.trim(), status: p.status, artistContactId: p.artist_contact_id }]),
  );

  const sheetRows = await guarded(() =>
    inChunks<{ id: string; track_id: string; kind: 'master' | 'composition'; status: string }>(
      songIds,
      (part, from, to) =>
        admin.from('split_sheets').select('id, track_id, kind, status').eq('org_id', orgId).in('track_id', part).in('status', ['circulated', 'signed', 'disputed']).order('id').range(from, to),
      'split sheets',
    ),
  );
  const lineRows = await guarded(() =>
    inChunks<{ split_sheet_id: string; party_id: string; share: number | string; position: number }>(
      sheetRows.map((s) => s.id),
      (part, from, to) =>
        admin.from('split_lines').select('split_sheet_id, party_id, share, position').eq('org_id', orgId).in('split_sheet_id', part).order('split_sheet_id').order('position').order('id').range(from, to),
      'split lines',
    ),
  );
  const linesOfSheet = new Map<string, { partyId: string; units: number; position: number }[]>();
  for (const l of lineRows) {
    // A share that does not parse (it cannot: numeric(7,4)) makes the sheet read as not adding up — never a guess.
    const units = parseShare(typeof l.share === 'number' ? l.share : String(l.share)) ?? -1;
    const list = linesOfSheet.get(l.split_sheet_id) ?? [];
    list.push({ partyId: l.party_id, units, position: l.position });
    linesOfSheet.set(l.split_sheet_id, list);
  }
  const sheets = new Map<string, SheetFact[]>();
  for (const s of sheetRows) {
    const lines = linesOfSheet.get(s.id) ?? [];
    const key = `${s.track_id}:${s.kind}`;
    sheets.set(key, [...(sheets.get(key) ?? []), { id: s.id, songId: s.track_id, kind: s.kind, status: s.status, lines }]);
  }

  const partyIds = new Set(sheetRows.length ? lineRows.map((l) => l.party_id) : []);
  const contracts = await loadContractFacts(admin, orgId, partyIds);

  const releaseItems = await guarded(() =>
    inChunks<{ release_id: string; song_track_id: string }>(
      songIds,
      (part, from, to) => admin.from('release_items').select('release_id, song_track_id').eq('org_id', orgId).in('song_track_id', part).order('song_track_id').order('release_id').range(from, to),
      'release items by song',
    ),
  );
  const releasesOfSong = new Map<string, Set<string>>();
  for (const it of releaseItems) releasesOfSong.set(it.song_track_id, new Set([...(releasesOfSong.get(it.song_track_id) ?? []), it.release_id]));
  return { sheets, payeeByParty, contracts, releasesOfSong };
}

/** Recoupable, live advances with what is still unrecouped. */
export async function loadAdvances(admin: AdminClient, orgId: string): Promise<AdvanceFact[]> {
  const advances = await guarded(() =>
    pageAll<{ id: string; payee_id: string; amount_minor: unknown; created_at: string }>(
      (from, to) =>
        admin.from('advances').select('id, payee_id, amount_minor, created_at').eq('org_id', orgId).eq('kind', 'recoupable').is('voided_at', null).order('created_at').order('id').range(from, to),
      'advances',
    ),
  );
  if (advances.length === 0) return [];
  const taken = await guarded(() =>
    inChunks<{ advance_id: string; amount_minor: unknown }>(
      advances.map((a) => a.id),
      (part, from, to) => admin.from('earnings_recoupments').select('advance_id, amount_minor').eq('org_id', orgId).in('advance_id', part).order('advance_id').order('id').range(from, to),
      'recoupments',
    ),
  );
  const used = new Map<string, bigint>();
  for (const r of taken) used.set(r.advance_id, (used.get(r.advance_id) ?? BigInt(0)) + minorFromDb(r.amount_minor));
  return advances.map((a) => ({ id: a.id, payeeId: a.payee_id, remainingMinor: minorFromDb(a.amount_minor) - (used.get(a.id) ?? BigInt(0)), createdAt: a.created_at }));
}

// ── The run ──────────────────────────────────────────────────────────────

export async function calculate(admin: AdminClient, orgId: string, currency: string, lines: readonly ParsedLine[]): Promise<RunResult> {
  const isrcs = uniq(lines.flatMap((l) => (l.isrc ? [l.isrc] : [])));
  const upcs = uniq(lines.flatMap((l) => (l.upc ? [l.upc] : [])));
  const match = await loadMatchFacts(admin, orgId, isrcs, upcs);
  const songIds = uniq([...match.songsOf.values()].flat());
  const [alloc, advances] = await Promise.all([loadAllocFacts(admin, orgId, songIds), loadAdvances(admin, orgId)]);
  return computeEarnings(lines, currency, match, alloc, advances);
}

const s = (n: bigint) => n.toString();

export type ImportHeader = { period_id: string | null; source: string; file_name: string | null; file_sha256: string; currency: string; row_count: number; total_minor: bigint };

export type ImportOutcome =
  | { ok: true; id: string; created: boolean }
  | { ok: false; code: 'recoup_conflict' | 'period_closed' | 'refused'; message: string };

function mapWriteError(error: NonNullable<DbError>): ImportOutcome | null {
  if (/recoup_exceeds|line_not_waiting/.test(error.message) || error.code === '40001') {
    return { ok: false, code: 'recoup_conflict', message: 'Advances or lines changed while this was running. Nothing was written; try again.' };
  }
  if (/period/.test(error.message)) return { ok: false, code: 'period_closed', message: 'That period cannot take new earnings.' };
  if (error.code === '23514' || error.code === '23503') return { ok: false, code: 'refused', message: 'The database refused these rows.' };
  return null;
}

export async function importEarnings(
  admin: AdminClient,
  orgId: string,
  userId: string,
  header: ImportHeader,
  lines: readonly ParsedLine[],
  run: RunResult,
): Promise<ImportOutcome> {
  await assertEarningsSchema(admin);
  const byNo = new Map(run.lines.map((l) => [l.lineNo, l]));
  const payload = lines.map((l) => {
    const r = byNo.get(l.lineNo);
    return {
      line_no: l.lineNo, isrc: l.isrc, upc: l.upc, track_id: r?.trackId ?? null, song_track_id: r?.songId ?? null, title: l.title, store: l.store,
      territory: l.territory, units: l.units, gross_minor: s(l.grossMinor), currency: header.currency, period_start: l.periodStart, period_end: l.periodEnd,
      income_class: l.incomeClass, review_reason: r?.reviewReason ?? null,
    };
  });
  const allocs = run.allocations.map((a) => ({
    line_no: a.lineNo, payee_id: a.payeeId, party_id: a.partyId, song_track_id: a.songId, kind: a.kind, sheet_id: a.sheetId, contract_id: a.contractId,
    share_units: a.shareUnits, share_minor: s(a.shareMinor), rate_units: a.rateUnits, payable_minor: s(a.payableMinor), retained_minor: s(a.retainedMinor),
  }));
  const recoups = run.recoups.map((r) => ({ line_no: r.lineNo, payee_id: r.payeeId, advance_id: r.advanceId, amount_minor: s(r.amountMinor) }));
  const res = await admin.rpc('labelos_earnings_import', {
    p_org: orgId,
    p_user: userId,
    p_import: { ...header, total_minor: s(header.total_minor), row_count: header.row_count },
    p_lines: payload,
    p_allocs: allocs,
    p_recoups: recoups,
  });
  if (res.error) {
    const mapped = mapWriteError(res.error);
    if (mapped) return mapped;
    check('earnings import', res.error);
  }
  const data = res.data as { id: string; created: boolean } | null;
  if (!data?.id) throw new Error('earnings import: no result');
  return { ok: true, id: data.id, created: data.created === true };
}

// ── Review queue + re-run ────────────────────────────────────────────────

export type ImportRow = {
  id: string; period_id: string | null; source: string; file_name: string | null; currency: string; row_count: number; total_minor: unknown; status: string; created_at: string;
};
export type ReviewLine = {
  id: string; import_id: string; line_no: number; isrc: string | null; upc: string | null; title: string | null; store: string | null; territory: string | null;
  gross_minor: unknown; currency: string; track_id: string | null; song_track_id: string | null; income_class: string; review_reason: ReviewReason | null; period_start: string | null; period_end: string | null;
};

const IMPORT_COLUMNS = 'id, period_id, source, file_name, currency, row_count, total_minor, status, created_at';
const LINE_COLUMNS = 'id, import_id, line_no, isrc, upc, title, store, territory, gross_minor, currency, track_id, song_track_id, income_class, review_reason, period_start, period_end';

export async function listImports(admin: AdminClient, orgId: string): Promise<ImportRow[]> {
  return guarded(() =>
    pageAll<ImportRow>((from, to) => admin.from('earnings_imports').select(IMPORT_COLUMNS).eq('org_id', orgId).order('created_at', { ascending: false }).order('id').range(from, to), 'imports'),
  );
}

export async function readImport(admin: AdminClient, orgId: string, importId: string): Promise<ImportRow | null> {
  const res = await admin.from('earnings_imports').select(IMPORT_COLUMNS).eq('org_id', orgId).eq('id', importId).maybeSingle();
  check('import read', res.error);
  return (res.data as ImportRow | null) ?? null;
}

/** Every line of an import still waiting for review (paged). */
export async function reviewLines(admin: AdminClient, orgId: string, importId: string | null): Promise<ReviewLine[]> {
  return guardedColumns(() =>
    pageAll<ReviewLine>((from, to) => {
      let q = admin.from('earnings_lines').select(LINE_COLUMNS).eq('org_id', orgId).not('review_reason', 'is', null);
      if (importId) q = q.eq('import_id', importId);
      return q.order('import_id').order('line_no').range(from, to);
    }, 'review lines'),
  );
}

/**
 * The song ids a member limited to some artists can see: the recordings of the
 * projects their scope reaches. `projectIds` comes from `orgProjectIdsInScope`.
 */
export async function trackIdsOfProjects(admin: AdminClient, projectIds: readonly string[]): Promise<Set<string>> {
  const rows = await guarded(() =>
    inChunks<{ track_id: string }>(
      projectIds,
      (part, from, to) => admin.from('project_tracks').select('track_id').in('project_id', part).order('project_id').order('track_id').range(from, to),
      'project tracks',
    ),
  );
  return new Set(rows.map((r) => r.track_id));
}

/**
 * Lines a viewer may see in the queue. A whole-org member sees all. A member
 * limited to some artists sees only lines whose matched recording or song is in
 * their scope: a line that matched nothing has no artist, and one whose ISRC
 * names a song outside their scope is not shown at all.
 */
export function visibleReviewLines(lines: readonly ReviewLine[], scope: ArtistScope, scopedTracks: ReadonlySet<string> | null): ReviewLine[] {
  if (scope === null) return [...lines];
  const tracks = scopedTracks ?? new Set<string>();
  return lines.filter((l) => (l.song_track_id && tracks.has(l.song_track_id)) || (l.track_id && tracks.has(l.track_id)));
}

export type ReprocessOutcome = { ok: true; resolved: number; stillWaiting: number } | Extract<ImportOutcome, { ok: false }>;

/**
 * Re-run the lines of one import that were waiting (after a sheet was
 * circulated, a payee made, an ISRC fixed). Lines that now allocate are
 * allocated and recouped (after everything already recouped, in line order);
 * the rest keep waiting with their current reason.
 */
export async function reprocessImport(admin: AdminClient, orgId: string, importId: string, waiting: readonly ReviewLine[]): Promise<ReprocessOutcome> {
  await assertEarningsSchema(admin);
  if (waiting.length === 0) return { ok: true, resolved: 0, stillWaiting: 0 };
  const imp = await readImport(admin, orgId, importId);
  if (!imp) return { ok: false, code: 'refused', message: 'Import not found.' };
  const parsed: ParsedLine[] = waiting.map((l) => ({
    lineNo: l.line_no, isrc: l.isrc, upc: l.upc, title: l.title, store: l.store, territory: l.territory, units: null,
    grossMinor: minorFromDb(l.gross_minor), periodStart: l.period_start, periodEnd: l.period_end, incomeClass: l.income_class === 'publishing' ? 'publishing' : 'master',
  }));
  const run = await calculate(admin, orgId, imp.currency.trim(), parsed);
  const idOf = new Map(waiting.map((l) => [l.line_no, l.id]));
  const lineUpdates = run.lines.map((r) => ({ line_id: idOf.get(r.lineNo), track_id: r.trackId, song_track_id: r.songId, review_reason: r.reviewReason }));
  const allocs = run.allocations.map((a) => ({
    line_id: idOf.get(a.lineNo), payee_id: a.payeeId, party_id: a.partyId, song_track_id: a.songId, kind: a.kind, sheet_id: a.sheetId, contract_id: a.contractId,
    share_units: a.shareUnits, share_minor: s(a.shareMinor), rate_units: a.rateUnits, payable_minor: s(a.payableMinor), retained_minor: s(a.retainedMinor),
  }));
  const recoups = run.recoups.map((r) => ({ line_id: idOf.get(r.lineNo), payee_id: r.payeeId, advance_id: r.advanceId, amount_minor: s(r.amountMinor) }));
  const res = await admin.rpc('labelos_earnings_resolve', { p_org: orgId, p_import: importId, p_lines: lineUpdates, p_allocs: allocs, p_recoups: recoups });
  if (res.error) {
    const mapped = mapWriteError(res.error);
    if (mapped && !mapped.ok) return mapped;
    check('earnings re-run', res.error);
  }
  const stillWaiting = run.lines.filter((l) => l.reviewReason !== null).length;
  return { ok: true, resolved: run.lines.length - stillWaiting, stillWaiting };
}

// ── Totals ───────────────────────────────────────────────────────────────

export type PayeeTotal = { payee_id: string; artist_contact_id: string | null; currency: string; share_minor: bigint; payable_minor: bigint; retained_minor: bigint; recouped_minor: bigint; net_minor: bigint };

/** Per-payee totals of an import, for the payees the viewer may read (`payeeIds` null = all). */
export async function importTotals(admin: AdminClient, orgId: string, importId: string, payeeIds: ReadonlySet<string> | null): Promise<PayeeTotal[]> {
  const allocs = await guarded(() =>
    pageAll<{ payee_id: string; artist_contact_id: string | null; currency: string; share_minor: unknown; payable_minor: unknown; retained_minor: unknown }>(
      (from, to) =>
        admin.from('earnings_allocations').select('payee_id, artist_contact_id, currency, share_minor, payable_minor, retained_minor').eq('org_id', orgId).eq('import_id', importId).order('id').range(from, to),
      'allocations',
    ),
  );
  const recs = await guarded(() =>
    pageAll<{ payee_id: string; amount_minor: unknown }>(
      (from, to) => admin.from('earnings_recoupments').select('payee_id, amount_minor').eq('org_id', orgId).eq('import_id', importId).order('id').range(from, to),
      'recoupments',
    ),
  );
  const totals = new Map<string, PayeeTotal>();
  for (const a of allocs) {
    if (payeeIds && !payeeIds.has(a.payee_id)) continue;
    const t = totals.get(a.payee_id) ?? { payee_id: a.payee_id, artist_contact_id: a.artist_contact_id, currency: a.currency.trim(), share_minor: BigInt(0), payable_minor: BigInt(0), retained_minor: BigInt(0), recouped_minor: BigInt(0), net_minor: BigInt(0) };
    t.share_minor += minorFromDb(a.share_minor);
    t.payable_minor += minorFromDb(a.payable_minor);
    t.retained_minor += minorFromDb(a.retained_minor);
    totals.set(a.payee_id, t);
  }
  for (const r of recs) {
    const t = totals.get(r.payee_id);
    if (t) t.recouped_minor += minorFromDb(r.amount_minor);
  }
  for (const t of totals.values()) t.net_minor = t.payable_minor - t.recouped_minor;
  return [...totals.values()].sort((a, b) => a.payee_id.localeCompare(b.payee_id));
}

