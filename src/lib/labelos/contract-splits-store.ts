/**
 * The reads and writes behind contract ↔ split sheet (LABEL-59). The rules are
 * `contract-splits.ts` (pure); this file loads rows and writes a DRAFT through
 * the existing LABEL-28 functions. No table and no migration of its own: a
 * contract already names its song (`contracts.track_id`, 176) and a sheet is
 * the song's, so the link between them is derived, never stored.
 *
 * Degrades like both halves do: 155 missing → `SplitsNotReadyError`, 176
 * missing → `ContractsNotReadyError`; the routes answer `schemaReady: false`
 * (GET) or 503 (writes), never 500.
 *
 * What leaves here is already scoped: `contractsOfSong` returns only contracts
 * the caller may read (`mayReadContract`: their artist scope, or a sent contract
 * that names them), and never selects `internal_note`.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isUUID } from '@/lib/validate';
import { partiesByIds } from './credits-store';
import { mayReadContract, type ContractActor } from './contracts/access';
import type { ContractPartyLink, ContractRow } from './contracts/context';
import { CONTRACTS_NOT_READY, ContractsNotReadyError, isMissingContractsSchema, linksOf } from './contracts-store';
import { canSignContract, deriveDrift, driftView, type ContractFacts, type DriftResult, type DriftView, type SheetFacts, type SigningCheck } from './contract-splits';
import { requireSignedMasterSplit } from './legal-readiness-store';
import { linesOfSheets, listSheets } from './splits-store';
import { unitsOf, type SplitSheetRow } from './splits';

export { CONTRACTS_NOT_READY };

/** The columns a song's splits view needs from a contract. `internal_note` is not among them. */
const SONG_CONTRACT_COLUMNS = 'id, type, title, status, artist_contact_id, track_id, fields, version';

type SongContractRow = Pick<ContractRow, 'id' | 'type' | 'title' | 'status' | 'artist_contact_id' | 'track_id' | 'fields' | 'version'>;

export const contractFacts = (row: Pick<ContractRow, 'type' | 'status' | 'track_id' | 'fields'>, links: readonly ContractPartyLink[]): ContractFacts => ({
  type: row.type,
  status: row.status,
  trackId: row.track_id,
  fields: row.fields ?? {},
  parties: [...links].sort((a, b) => a.position - b.position).map((l) => ({ partyId: l.party_id, role: l.role })),
});

/** The sheets of a song as drift sees them: kind, status and each line's party and units. */
export async function sheetFactsOfSong(admin: AdminClient, org: string, trackId: string): Promise<{ sheets: SplitSheetRow[]; facts: (SheetFacts & { id: string })[] }> {
  const sheets = await listSheets(admin, org, trackId);
  const lines = await linesOfSheets(admin, org, sheets.map((s) => s.id));
  return {
    sheets,
    facts: sheets.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      lines: (lines.get(s.id) ?? []).map((l) => ({ partyId: l.party_id, units: unitsOf(l.share) })),
    })),
  };
}

/** One DriftResult per live sheet of the song the contract has a rule for. */
export function driftOfContract(contract: ContractFacts, facts: readonly (SheetFacts & { id: string })[]): (DriftResult & { sheetId: string })[] {
  const out: (DriftResult & { sheetId: string })[] = [];
  for (const sheet of facts) {
    const d = deriveDrift(contract, sheet);
    if (d && d.checked) out.push({ ...d, sheetId: sheet.id });
  }
  return out;
}

export type SongContractDrift = {
  contractId: string;
  title: string;
  status: string;
  type: string;
  drift: (DriftView & { sheetId: string })[];
};

/**
 * The contracts that name this song and that THIS actor may read, each with the
 * drift of the song's live sheets against it. `detail` = the reader holds
 * `rights.read` (names and both numbers); otherwise only whether it drifted (D2).
 * A void contract is left out: it no longer says anything.
 */
export async function contractsOfSong(
  admin: AdminClient,
  org: string,
  trackId: string,
  actor: ContractActor,
  opts: { detail: boolean },
): Promise<SongContractDrift[]> {
  const res = await admin.from('contracts').select(SONG_CONTRACT_COLUMNS).eq('org_id', org).eq('track_id', trackId).neq('status', 'void').order('created_at', { ascending: false }).limit(50);
  if (res.error) {
    if (isMissingContractsSchema(res.error)) throw new ContractsNotReadyError();
    throw new Error(`song contracts: ${res.error.message}`);
  }
  const rows = (res.data ?? []) as unknown as SongContractRow[];
  if (rows.length === 0) return [];
  const links = await linksOf(admin, org, rows.map((r) => r.id));
  const readable = rows.filter((r) => mayReadContract(actor, { status: r.status, artist_contact_id: r.artist_contact_id, partyIds: (links.get(r.id) ?? []).map((l) => l.party_id) }));
  if (readable.length === 0) return [];

  const { facts } = await sheetFactsOfSong(admin, org, trackId);
  const drifts = readable.map((r) => ({ row: r, drift: driftOfContract(contractFacts(r, links.get(r.id) ?? []), facts) }));
  const partyIds = opts.detail ? [...new Set(drifts.flatMap((d) => d.drift.flatMap((x) => x.items.map((i) => i.partyId))))] : [];
  const parties = partyIds.length > 0 ? await partiesByIds(admin, org, partyIds) : new Map();
  const nameOf = (id: string) => parties.get(id)?.display_name ?? 'Unknown';
  return drifts.map(({ row, drift }) => ({
    contractId: row.id,
    title: row.title,
    status: row.status,
    type: row.type,
    drift: drift.map((d) => ({ ...driftView(d, opts.detail, nameOf), sheetId: d.sheetId })),
  }));
}

/**
 * The server helper for LABEL-60: refuse to move a contract to `signed` while
 * the org requires a signed master split and the song's master sheet is not.
 * Call it before the `sent → signed` write and answer 409 with `error` and
 * `code` when `ok` is false. Off, or a contract with no master rule or song,
 * passes without reading a sheet.
 */
export async function assertCanSign(admin: AdminClient, org: string, row: Pick<ContractRow, 'type' | 'track_id'>): Promise<SigningCheck> {
  const required = await requireSignedMasterSplit(admin, org);
  if (!required || !row.track_id || !isUUID(row.track_id)) return { ok: true };
  const sheets = await listSheets(admin, org, row.track_id);
  return canSignContract({
    requireSignedMasterSplit: required,
    contract: { type: row.type, trackId: row.track_id },
    masterSheets: sheets.filter((s) => s.kind === 'master'),
  });
}
