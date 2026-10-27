/**
 * /api/org/[orgId]/contracts/[contractId] (LABEL-57).
 *
 *   GET    one contract with its text filled in (`document`: clauses + the merge
 *          fields still empty). A contract the caller may not read is 404.
 *          For contracts staff (`contracts.read`) it also carries the wording
 *          (`clauses`, with a mark per clause against the template it started
 *          from), the per-version `history`, and the stored PDF of this version.
 *   PATCH  edit a DRAFT (title, links, term, territories, fields, parties,
 *          clauses, internal note) — `contracts.write`, inside the caller's
 *          artist scope — or `{ status: 'void', void_reason? }`. Any change to
 *          the contract's content is the next `version` (LABEL-58); the note
 *          is not content. `base_version` makes a stale editor a 409.
 *          Sending for signature is `…/send`; signing is LABEL-60. A contract
 *          past draft is not edited (409), the database says the same.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { memberIdentities, type IdentityAdmin } from '@/lib/labelos/member-identity';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { readsAllContracts } from '@/lib/labelos/contracts/access';
import { contractView } from '@/lib/labelos/contracts/context';
import { cleanContractClauses, markClauses } from '@/lib/labelos/contracts/clause-edit';
import { buildHistory, HISTORY_VERBS } from '@/lib/labelos/contracts/history';
import { contractDocumentFileName } from '@/lib/labelos/contracts/document';
import { cleanFields } from '@/lib/labelos/contracts/merge-fields';
import { sameClauses, changedClauseIds } from '@/lib/labelos/contracts/template-edit';
import { platformTemplate } from '@/lib/labelos/contracts/templates';
import { isEditable, type PartyRole } from '@/lib/labelos/contracts/types';
import { documentOf, loadContractFor } from '@/lib/labelos/contracts-route';
import {
  CONTRACTS_NOT_READY,
  ContractSaveError,
  ContractsNotReadyError,
  contractEvents,
  contractProjectId,
  findContractCopy,
  isMissingContractsSchema,
  linkedInOrg,
  partiesInOrg,
  readContractRow,
  saveContract,
  templateBase,
  writeDraftVersion,
} from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.id');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Contract not found' });

type Params = { params: Promise<{ orgId: string; contractId: string }> };

const loadFor = loadContractFor;

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return NOT_FOUND();
  try {
    const loaded = await loadFor(access, contractId);
    if (!loaded) return NOT_FOUND();
    const { actor, row, links, identities } = loaded;
    const document = await documentOf(access.admin, access.orgId, row, links, identities);
    const staff = access.capabilities.has('contracts.read');
    const body: Record<string, unknown> = {
      contract: contractView(row, links, identities, readsAllContracts(actor)),
      document,
      canWrite: access.capabilities.has('contracts.write') && isEditable(row.status) && scopeAllowsContact(access.artistScope, row.artist_contact_id),
    };
    if (staff) {
      // The wording, how it differs from the template it started from, the per-version history and the stored PDF of this version.
      const base = await templateBase(access.admin, access.orgId, row, (t) => platformTemplate(t).clauses);
      const headings = new Map(row.clauses.map((c) => [c.id, c.heading]));
      for (const c of base) if (!headings.has(c.id)) headings.set(c.id, c.heading);
      const projectId = await contractProjectId(access.admin, access.orgId, row);
      body.clauses = row.clauses;
      body.clause_marks = markClauses(base, row.clauses);
      const history = buildHistory(await contractEvents(access.admin, access.orgId, row.id, HISTORY_VERBS), (id) => headings.get(id) ?? null);
      const identitiesOfActors = await memberIdentities(access.admin as unknown as IdentityAdmin, access.orgId, [...new Set(history.map((h) => h.actorId).filter((x): x is string => !!x))], { withEmail: false });
      body.history = history;
      body.history_actors = Object.fromEntries([...identitiesOfActors].filter(([, who]) => !!who.name).map(([id, who]) => [id, who.name]));
      body.can_manage = access.capabilities.has('contracts.write') && row.status !== 'void' && scopeAllowsContact(access.artistScope, row.artist_contact_id);
      body.copy = projectId ? await findContractCopy(access.admin, access.orgId, projectId, contractDocumentFileName(row.id, row.version, row.status)) : null;
      body.can_store = projectId !== null;
    }
    return json(200, body);
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return NOT_FOUND();
    log.error('contract read failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the contract' });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return NOT_FOUND();
  const parsed = await readBody(req, OrgContractPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const { admin, orgId: org } = access;

  try {
    const loaded = await loadFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return NOT_FOUND();
    const { row } = loaded;
    const subject = { type: 'contract' as const, id: row.id, artistId: row.artist_contact_id, songId: row.track_id, releaseId: row.release_id };

    if (body.status === 'void') {
      if (row.status === 'void') return json(409, { error: 'This contract is already void' });
      // Voiding is final, so the status change and its audit event are ONE transaction (migration 176).
      const { data, error } = await auditRpc(admin, 'contractVoid', {
        p_org: org,
        p_actor: access.userId,
        p_contract: row.id,
        p_reason: body.void_reason ?? null,
        p_payload: { with_reason: !!body.void_reason },
      });
      if (error) {
        if (isMissingAuditRpc(error) || isMissingContractsSchema(error)) return json(503, { error: CONTRACTS_NOT_READY });
        throw new Error(`contract void: ${error.message}`);
      }
      if (data?.error === 'already_void') return json(409, { error: 'This contract is already void' });
      if (data?.error === 'not_found') return NOT_FOUND();
      return json(200, { ok: true });
    }

    if (!isEditable(row.status)) return json(409, { error: 'Only a draft contract can be edited' });

    const patch: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const key of ['title', 'artist_contact_id', 'track_id', 'release_id', 'effective_date', 'term_months', 'territories', 'internal_note'] as const) {
      if (body[key] !== undefined) {
        patch[key] = body[key];
        changed.push(key);
      }
    }
    if (body.artist_contact_id !== undefined && !scopeAllowsContact(access.artistScope, body.artist_contact_id)) {
      return json(403, { error: 'You can start contracts for your own artists only' });
    }
    if (body.fields !== undefined) {
      const fields = cleanFields(body.fields);
      if (!fields.ok) return json(400, { error: fields.error });
      patch.fields = fields.fields;
      changed.push('fields');
    }
    if (body.base_version !== undefined && body.base_version !== row.version) {
      return json(409, { error: 'Someone saved this contract after you opened it. Reload to see their changes.' });
    }
    let clauses: ReturnType<typeof cleanContractClauses> | null = null;
    if (body.clauses !== undefined) {
      clauses = cleanContractClauses(body.clauses);
      if (!clauses.ok) return json(400, { error: clauses.error });
      if (sameClauses(clauses.clauses, row.clauses)) clauses = null;
      else changed.push('clauses');
    }
    let parties: { party_id: string; role: PartyRole; position: number }[] | null = null;
    if (body.parties !== undefined) {
      const slots = platformTemplate(row.type).slots;
      const roles = new Set<PartyRole>(slots.map((s) => s.role));
      const wrong = body.parties.find((p) => !roles.has(p.role));
      if (wrong) return json(400, { error: `This contract has no "${wrong.role}" party` });
      const many = slots.find((s) => !s.many && body.parties!.filter((p) => p.role === s.role).length > 1);
      if (many) return json(400, { error: `This contract has one ${many.label.toLowerCase()}` });
      if (!(await partiesInOrg(admin, org, body.parties.map((p) => p.party_id)))) return json(404, { error: 'A party was not found in this organization' });
      parties = body.parties.map((p, i) => ({ party_id: p.party_id, role: p.role, position: i }));
      changed.push('parties');
    }
    const bad = await linkedInOrg(admin, org, { artist: body.artist_contact_id, track: body.track_id, release: body.release_id });
    if (bad) return json(404, { error: bad });

    if (changed.length === 0) return json(200, { ok: true, version: row.version });
    await saveContract(admin, org, access.userId, row.id, patch, parties);

    // The next version: anything but the internal note is the contract's content (LABEL-58).
    let version = row.version;
    const contentChanged = changed.some((k) => k !== 'internal_note');
    if (contentChanged) {
      const next = await writeDraftVersion(admin, org, row.id, row.version, clauses?.ok ? clauses.clauses : null);
      if (next === null) return json(409, { error: 'Someone saved this contract while you were editing. Reload to see their changes.' });
      version = next;
    }
    await recordEvent(
      admin,
      { orgId: org, userId: access.userId },
      'contract.updated',
      { ...subject, artistId: body.artist_contact_id !== undefined ? body.artist_contact_id : row.artist_contact_id },
      { changed, ...(clauses?.ok ? { changed_clauses: changedClauseIds(row.clauses, clauses.clauses) } : {}), version },
    );
    return json(200, { ok: true, version });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    if (err instanceof ContractSaveError) return json(err.kind === 'not_found' ? 404 : err.kind === 'not_draft' ? 409 : 400, { error: err.message });
    log.error('contract update failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not update the contract' });
  }
}
