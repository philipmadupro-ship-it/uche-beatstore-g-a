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
import type { PartyRole, TemplateTypeId } from './contracts/types';
import { inChunks, pageAll } from './paged-read';

export const CONTRACTS_NOT_READY = 'Contracts are not set up on this database yet (migration 176).';

export class ContractsNotReadyError extends Error {
  constructor() {
    super('migration 176 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

export function isMissingContractsSchema(error: DbError): boolean {
  if (!error) return false;
  return ['PGRST205', '42P01', '42703', 'PGRST204', 'PGRST202', '42883'].includes(error.code ?? '');
}

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingContractsSchema(error)) throw new ContractsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
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
  try {
    return await pageAll<TemplateRow>(
      (from, to) => admin.from('contract_templates').select(TEMPLATE_COLUMNS).eq('org_id', org).order('type').order('version', { ascending: false }).range(from, to),
      'template list',
    );
  } catch (err) {
    if (err && typeof err === 'object' && 'raw' in err) check('template list', { message: String((err as { raw: { message: string } }).raw.message), code: (err as { raw: { code?: string } }).raw.code });
    throw err;
  }
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

export async function listContractRows(admin: AdminClient, org: string): Promise<ContractRow[]> {
  const rows = await pageAll<unknown>(
    (from, to) => admin.from('contracts').select(CONTRACT_LIST_COLUMNS).eq('org_id', org).order('created_at', { ascending: false }).order('id').range(from, to),
    'contract list',
  ).catch((err) => {
    const raw = (err as { raw?: { message: string; code?: string } }).raw;
    if (raw) check('contract list', raw);
    throw err;
  });
  return rows.map(asRow);
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
  );
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

export async function linkedInOrg(admin: AdminClient, org: string, ids: { artist?: string | null; track?: string | null; release?: string | null }): Promise<string | null> {
  const probe = async (table: string, id: string | null | undefined): Promise<boolean> => {
    if (!id) return true;
    const res = await admin.from(table).select('id').eq('org_id', org).eq('id', id).maybeSingle();
    return !res.error && !!res.data;
  };
  if (!(await probe('contacts', ids.artist))) return 'That artist is not in this organization';
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

/** Void a contract that has not been voided; the trigger refuses a void one. Returns false when nothing matched. */
export async function voidContract(admin: AdminClient, org: string, id: string, actor: string, reason: string | null): Promise<boolean> {
  await assertContractsSchema(admin);
  const res = await admin
    .from('contracts')
    .update({ status: 'void', voided_by: actor, voided_at: new Date().toISOString(), void_reason: reason })
    .eq('org_id', org)
    .eq('id', id)
    .neq('status', 'void')
    .select('id');
  check('contract void', res.error);
  return (res.data ?? []).length > 0;
}
