/**
 * The reads and writes behind the contract routes (LABEL-57). Rules are in
 * `contracts/*`; this file only touches the database. Service-role client,
 * org filter on every query; authorisation is the route's. Rows leave only
 * through `contracts/context#contractView`.
 *
 * Migration 176 may not be applied: a missing table or function is
 * `ContractsNotReadyError`, which routes answer as "not set up yet" (GET:
 * `schemaReady: false`; writes: 503 naming 176). PostgREST answers an INSERT
 * into a missing table with an empty 404 that carries no code, so every write
 * probes with a read first (`assertContractsSchema`).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isUUID } from '@/lib/validate';
import type { TemplateClause } from './contracts/templates';
import type { ContractPartyLink, ContractRow, PartyIdentity } from './contracts/context';
import type { HistoryEvent } from './contracts/history';
import type { PartyRole, TemplateTypeId } from './contracts/types';
import { inChunks, pageAll, ReadError } from './paged-read';
import { hasArtistRole } from './roster';

export const CONTRACTS_NOT_READY = 'Contracts are not set up on this database yet (migrations 174 and 176).';

export class ContractsNotReadyError extends Error {
  constructor() {
    super('migration 176 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

export function isMissingContractsSchema(error: DbError): boolean {
  if (!error) return false;
  // A missing relation or function only: a missing COLUMN is a bug (or another migration), never "not set up".
  return ['PGRST205', '42P01', 'PGRST202', '42883'].includes(error.code ?? '');
}

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingContractsSchema(error)) throw new ContractsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

/** A paged read that failed: a missing relation is `ContractsNotReadyError`, anything else stays what it was. */
function rethrowRead(err: unknown): never {
  if (err instanceof ReadError) check(err.message, err.raw as DbError);
  throw err;
}

/** A read before any write: an INSERT into a missing table is an empty 404 PostgREST gives no code for. */
export async function assertContractsSchema(admin: AdminClient): Promise<void> {
  const res = await admin.from('contracts').select('id').limit(1);
  check('contracts probe', res.error);
}

export const CONTRACT_LIST_COLUMNS =
  'id, type, title, status, template_id, template_source, template_version, artist_contact_id, track_id, release_id, effective_date, term_months, territories, fields, internal_note, version, created_by, voided_at, void_reason, created_at, updated_at';
export const CONTRACT_COLUMNS = `${CONTRACT_LIST_COLUMNS}, clauses`;

// ── Templates ───────────────────────────────────────────────────────────

export type TemplateRow = {
  id: string;
  type: TemplateTypeId;
  version: number;
  name: string;
  clauses: TemplateClause[];
  based_on: string | null;
  created_by: string | null;
  created_at: string;
};
const TEMPLATE_COLUMNS = 'id, type, version, name, clauses, based_on, created_by, created_at';

/** Every version of the org's own templates, newest first within a type. */
export async function listOrgTemplates(admin: AdminClient, org: string): Promise<TemplateRow[]> {
  return pageAll<TemplateRow>(
    (from, to) => admin.from('contract_templates').select(TEMPLATE_COLUMNS).eq('org_id', org).order('type').order('version', { ascending: false }).range(from, to),
    'template list',
  ).catch(rethrowRead);
}

export async function latestOrgTemplate(admin: AdminClient, org: string, type: TemplateTypeId): Promise<TemplateRow | null> {
  const res = await admin.from('contract_templates').select(TEMPLATE_COLUMNS).eq('org_id', org).eq('type', type).order('version', { ascending: false }).limit(1);
  check('template read', res.error);
  return ((res.data ?? [])[0] as unknown as TemplateRow | undefined) ?? null;
}

export async function readOrgTemplate(admin: AdminClient, org: string, id: string): Promise<TemplateRow | null> {
  if (!isUUID(id)) return null;
  const res = await admin.from('contract_templates').select(TEMPLATE_COLUMNS).eq('org_id', org).eq('id', id).maybeSingle();
  check('template read', res.error);
  return (res.data as unknown as TemplateRow | null) ?? null;
}

/** The next version of (org, type). A concurrent save loses the unique index: `{ conflict: true }`, the editor reloads. */
export async function insertTemplateVersion(
  admin: AdminClient,
  org: string,
  actor: string,
  input: { type: TemplateTypeId; name: string; clauses: TemplateClause[]; basedOn: string | null },
): Promise<{ row: TemplateRow } | { conflict: true }> {
  await assertContractsSchema(admin);
  const latest = await latestOrgTemplate(admin, org, input.type);
  const res = await admin
    .from('contract_templates')
    .insert({ org_id: org, type: input.type, version: (latest?.version ?? 0) + 1, name: input.name, clauses: input.clauses, based_on: input.basedOn, created_by: actor })
    .select(TEMPLATE_COLUMNS)
    .single();
  if (res.error?.code === '23505') return { conflict: true };
  check('template insert', res.error);
  return { row: res.data as unknown as TemplateRow };
}

// ── Contracts ───────────────────────────────────────────────────────────

/** Rows come back with `fields` and `territories` in their stored shape. */
function asRow(raw: unknown): ContractRow {
  return raw as ContractRow;
}

/**
 * Which rows to read. The caller's rights are decided by `mayReadContract`
 * either way; this only keeps the read from paging the whole org for someone
 * who can read a few: `all` (whole-org staff), `artists` (staff or an artist
 * limited to these contacts), `own` (sent contracts naming these parties
 * and / or these artists).
 */
export type ContractReadScope =
  | { kind: 'all' }
  | { kind: 'artists'; contactIds: readonly string[]; sentOnly: boolean; partyIds: readonly string[] }
  | { kind: 'own'; contactIds: readonly string[]; partyIds: readonly string[] };

const listPage = (admin: AdminClient, org: string, narrow: (q: ReturnType<typeof base>) => ReturnType<typeof base>) =>
  pageAll<unknown>((from, to) => narrow(base(admin, org)).order('created_at', { ascending: false }).order('id').range(from, to), 'contract list').catch(rethrowRead);
const base = (admin: AdminClient, org: string) => admin.from('contracts').select(CONTRACT_LIST_COLUMNS).eq('org_id', org);

export async function listContractRows(admin: AdminClient, org: string, scope: ContractReadScope = { kind: 'all' }): Promise<ContractRow[]> {
  if (scope.kind === 'all') return (await listPage(admin, org, (q) => q)).map(asRow);
  const found = new Map<string, ContractRow>();
  const add = (rows: unknown[]) => rows.forEach((r) => found.set((r as ContractRow).id, asRow(r)));
  const sentOnly = scope.kind === 'own' || scope.sentOnly;
  if (scope.contactIds.length > 0) {
    for (const part of [...new Set(scope.contactIds)].reduce<string[][]>((acc, id, i) => ((i % 200 === 0 ? acc.push([id]) : acc[acc.length - 1].push(id)), acc), [])) {
      add(await listPage(admin, org, (q) => (sentOnly ? q.neq('status', 'draft') : q).in('artist_contact_id', part)));
    }
  }
  if (scope.partyIds.length > 0) {
    const linked = await inChunks<{ contract_id: string }>(
      scope.partyIds,
      (part, from, to) => admin.from('contract_parties').select('contract_id').eq('org_id', org).in('party_id', part).order('contract_id').range(from, to),
      'own contract parties',
    ).catch(rethrowRead);
    const ids = [...new Set(linked.map((l) => l.contract_id))].filter((id) => !found.has(id));
    for (let i = 0; i < ids.length; i += 200) add(await listPage(admin, org, (q) => q.neq('status', 'draft').in('id', ids.slice(i, i + 200))));
  }
  return [...found.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

export async function readContractRow(admin: AdminClient, org: string, id: string): Promise<ContractRow | null> {
  if (!isUUID(id)) return null;
  const res = await admin.from('contracts').select(CONTRACT_COLUMNS).eq('org_id', org).eq('id', id).maybeSingle();
  check('contract read', res.error);
  return res.data ? asRow(res.data) : null;
}

export async function linksOf(admin: AdminClient, org: string, contractIds: readonly string[]): Promise<Map<string, ContractPartyLink[]>> {
  const rows = await inChunks<{ contract_id: string; party_id: string; role: PartyRole; position: number }>(
    contractIds,
    (part, from, to) => admin.from('contract_parties').select('contract_id, party_id, role, position').eq('org_id', org).in('contract_id', part).order('contract_id').order('position').order('party_id').range(from, to),
    'contract parties',
  );
  const out = new Map<string, ContractPartyLink[]>();
  for (const r of rows) (out.get(r.contract_id) ?? out.set(r.contract_id, []).get(r.contract_id)!).push({ party_id: r.party_id, role: r.role, position: r.position });
  return out;
}

/** Name, legal name and address only — never a payee column. */
export async function identitiesOf(admin: AdminClient, org: string, partyIds: readonly string[]): Promise<Map<string, PartyIdentity>> {
  const rows = await inChunks<PartyIdentity>(
    partyIds,
    (part, from, to) => admin.from('parties').select('id, display_name, legal_name, address').eq('org_id', org).in('id', part).order('id').range(from, to),
    'party identities',
  ).catch((err) => {
    // `parties.address` is migration 174's: without it contracts cannot name a party's address, and say so (503), not 500.
    if (err instanceof ReadError && err.raw && (err.raw as { code?: string }).code === '42703') throw new ContractsNotReadyError();
    return rethrowRead(err);
  });
  return new Map(rows.map((r) => [r.id, r]));
}

export async function ownPartyIds(admin: AdminClient, org: string, userId: string): Promise<Set<string>> {
  const res = await admin.from('parties').select('id').eq('org_id', org).eq('user_id', userId);
  check('own parties', res.error);
  return new Set(((res.data ?? []) as { id: string }[]).map((r) => r.id));
}

/** Names of the linked artist / song / release for the document. Org-filtered. */
export async function linkedNames(admin: AdminClient, org: string, row: Pick<ContractRow, 'artist_contact_id' | 'track_id' | 'release_id'>) {
  const one = async (table: 'contacts' | 'tracks' | 'releases', column: 'name' | 'title', id: string | null): Promise<string | null> => {
    if (!id) return null;
    const res = await admin.from(table).select(column).eq('org_id', org).eq('id', id).maybeSingle();
    if (res.error) return null;
    return ((res.data as unknown as Record<string, string> | null)?.[column]) ?? null;
  };
  const [artist, song, release] = await Promise.all([one('contacts', 'name', row.artist_contact_id), one('tracks', 'title', row.track_id), one('releases', 'title', row.release_id)]);
  return { artistName: artist, songTitle: song, releaseTitle: release };
}

/** The contact must be a ROSTER artist of the org (an artist role, or in workspace mode): the read rules treat the contract's contact as the artist. */
async function isRosterArtist(admin: AdminClient, org: string, id: string): Promise<boolean> {
  const res = await admin.from('contacts').select('category, secondary_category').eq('org_id', org).eq('id', id).maybeSingle();
  if (res.error || !res.data) return false;
  return hasArtistRole(res.data as { category: string | null; secondary_category: string | null });
}

export async function linkedInOrg(admin: AdminClient, org: string, ids: { artist?: string | null; track?: string | null; release?: string | null }): Promise<string | null> {
  const probe = async (table: string, id: string | null | undefined): Promise<boolean> => {
    if (!id) return true;
    const res = await admin.from(table).select('id').eq('org_id', org).eq('id', id).maybeSingle();
    return !res.error && !!res.data;
  };
  if (!(await probe('contacts', ids.artist))) return 'That artist is not in this organization';
  if (ids.artist && !(await isRosterArtist(admin, org, ids.artist))) return 'That contact is not an artist on your roster';
  if (!(await probe('tracks', ids.track))) return 'That song is not in this organization';
  if (!(await probe('releases', ids.release))) return 'That release is not in this organization';
  return null;
}

export async function partiesInOrg(admin: AdminClient, org: string, partyIds: readonly string[]): Promise<boolean> {
  const unique = [...new Set(partyIds)];
  if (unique.length === 0) return true;
  const found = await identitiesOf(admin, org, unique);
  return found.size === unique.length;
}

export type SaveRow = Record<string, unknown>;

export class ContractSaveError extends Error {
  constructor(readonly kind: 'not_found' | 'not_draft' | 'invalid', message: string) {
    super(message);
  }
}

/** Create (`id` null) or edit a draft and replace its parties, atomically (migration 176). */
export async function saveContract(
  admin: AdminClient,
  org: string,
  actor: string,
  id: string | null,
  row: SaveRow,
  parties: { party_id: string; role: PartyRole; position: number }[] | null,
): Promise<string> {
  await assertContractsSchema(admin);
  const res = await admin.rpc('labelos_contract_save', { p_org: org, p_actor: actor, p_id: id, p_row: row, p_parties: parties });
  if (res.error) {
    if (isMissingContractsSchema(res.error)) throw new ContractsNotReadyError();
    if (/not_found/.test(res.error.message)) throw new ContractSaveError('not_found', 'Contract not found');
    if (/not_draft/.test(res.error.message)) throw new ContractSaveError('not_draft', 'Only a draft contract can be edited');
    if (res.error.code === '23514' || res.error.code === '23503' || res.error.code === '23505') throw new ContractSaveError('invalid', res.error.message);
    throw new Error(`contract save: ${res.error.message}`);
  }
  return res.data as unknown as string;
}

// ── LABEL-58: clause edits, sending, the document ──────────────────────────

/**
 * Bump a draft's version, and write its clauses with the same statement when
 * they changed. Compare-and-set on (status = draft, version = expected): two
 * editors cannot both write version N+1. Returns the new version, or null when
 * the row moved on (someone else saved, or it is no longer a draft).
 */
export async function writeDraftVersion(admin: AdminClient, org: string, id: string, expected: number, clauses: TemplateClause[] | null): Promise<number | null> {
  await assertContractsSchema(admin);
  const res = await admin
    .from('contracts')
    .update({ version: expected + 1, ...(clauses ? { clauses } : {}) })
    .eq('org_id', org)
    .eq('id', id)
    .eq('status', 'draft')
    .eq('version', expected)
    .select('version');
  check('contract version', res.error);
  return ((res.data ?? [])[0] as { version: number } | undefined)?.version ?? null;
}

/** draft → sent in one conditional UPDATE: of two requests only one claims it. The content-freeze trigger (176) takes over from here. */
export async function claimSend(admin: AdminClient, org: string, id: string, version: number): Promise<boolean> {
  await assertContractsSchema(admin);
  const res = await admin.from('contracts').update({ status: 'sent' }).eq('org_id', org).eq('id', id).eq('status', 'draft').eq('version', version).select('id');
  check('contract send', res.error);
  return (res.data ?? []).length === 1;
}

/** The wording the contract started from: the org's template version it names, else the platform default. */
export async function templateBase(admin: AdminClient, org: string, row: Pick<ContractRow, 'type' | 'template_id'>, platform: (type: TemplateTypeId) => readonly TemplateClause[]): Promise<readonly TemplateClause[]> {
  if (row.template_id) {
    const t = await readOrgTemplate(admin, org, row.template_id).catch(() => null);
    if (t) return t.clauses;
  }
  return platform(row.type);
}

/**
 * The project a contract's PDF is filed in: its release's project, else the
 * song's (the Inbox project of the artist first, as every other song event is
 * filed). No release and no song in a project → null: the PDF is made on
 * request and not stored, rather than invented a place outside a project.
 */
export async function contractProjectId(admin: AdminClient, org: string, row: Pick<ContractRow, 'release_id' | 'track_id'>): Promise<string | null> {
  if (row.release_id) {
    const res = await admin.from('releases').select('project_id').eq('org_id', org).eq('id', row.release_id).maybeSingle();
    if (!res.error && (res.data as { project_id?: string } | null)?.project_id) return (res.data as { project_id: string }).project_id;
  }
  if (row.track_id) {
    const { songEventSubject } = await import('./song-stage-store');
    const song = await songEventSubject(admin, org, row.track_id);
    if (song.projectId) return song.projectId;
  }
  return null;
}

export type ContractCopy = { asset_id: string; project_id: string };

/** The stored PDF of this contract version, if one was made (the file name is the key: one per version). */
export async function findContractCopy(admin: AdminClient, org: string, projectId: string, fileName: string): Promise<ContractCopy | null> {
  const res = await admin.from('project_assets').select('id, project_id').eq('org_id', org).eq('project_id', projectId).eq('kind', 'contract').eq('file_name', fileName).limit(1);
  if (res.error) return null;
  const row = ((res.data ?? [])[0] as { id: string; project_id: string } | undefined) ?? null;
  return row ? { asset_id: row.id, project_id: row.project_id } : null;
}

/** Insert the restricted `contract` project file a generated PDF is kept as (143: a contract file is always restricted). */
export async function insertContractPdfRow(
  admin: AdminClient,
  a: { org: string; projectId: string; createdBy: string; url: string; fileName: string; size: number; label: string },
): Promise<string> {
  const { data: last } = await admin.from('project_assets').select('position').eq('org_id', a.org).eq('project_id', a.projectId).order('position', { ascending: false }).limit(1);
  const position = ((last as Array<{ position: number }> | null)?.[0]?.position ?? -1) + 1;
  const res = await admin
    .from('project_assets')
    .insert({
      user_id: null,
      org_id: a.org,
      created_by: a.createdBy,
      project_id: a.projectId,
      kind: 'contract',
      sensitivity: 'restricted',
      label: a.label.slice(0, 200),
      file_name: a.fileName,
      url: a.url,
      mime: 'application/pdf',
      size_bytes: a.size,
      position,
      in_portal: false,
      portal_at: null,
    })
    .select('id')
    .single();
  check('contract document insert', res.error);
  return (res.data as { id: string }).id;
}

/** A contract's own events (created / edited / sent / voided / PDF made), newest first, bounded. */
export async function contractEvents(admin: AdminClient, org: string, id: string, verbs: readonly string[]): Promise<HistoryEvent[]> {
  const res = await admin
    .from('activity_events')
    .select('id, verb, actor_id, payload, created_at')
    .eq('org_id', org)
    .eq('subject_type', 'contract')
    .eq('subject_id', id)
    .in('verb', [...verbs])
    .order('created_at', { ascending: false })
    .limit(200);
  if (res.error) return [];
  return (res.data ?? []) as unknown as HistoryEvent[];
}
