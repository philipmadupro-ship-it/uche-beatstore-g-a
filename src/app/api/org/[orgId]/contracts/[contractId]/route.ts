/**
 * /api/org/[orgId]/contracts/[contractId] (LABEL-57).
 *
 *   GET    one contract with its text filled in (`document`: clauses + the merge
 *          fields still empty). A contract the caller may not read is 404.
 *   PATCH  edit a DRAFT (title, links, term, territories, fields, parties,
 *          internal note) — `contracts.write`, inside the caller's artist
 *          scope — or `{ status: 'void', void_reason? }`. Sending for signature
 *          and signing are LABEL-58 / LABEL-60; a contract past draft is not
 *          edited (409), the database says the same.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { mayReadContract, readsAllContracts } from '@/lib/labelos/contracts/access';
import { contractView } from '@/lib/labelos/contracts/context';
import { cleanFields } from '@/lib/labelos/contracts/merge-fields';
import { platformTemplate } from '@/lib/labelos/contracts/templates';
import { isEditable, type PartyRole } from '@/lib/labelos/contracts/types';
import { contractActor, documentOf } from '@/lib/labelos/contracts-route';
import {
  CONTRACTS_NOT_READY,
  ContractSaveError,
  ContractsNotReadyError,
  identitiesOf,
  isMissingContractsSchema,
  linkedInOrg,
  linksOf,
  partiesInOrg,
  readContractRow,
  saveContract,
} from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.id');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Contract not found' });

type Params = { params: Promise<{ orgId: string; contractId: string }> };

async function loadFor(access: Extract<Awaited<ReturnType<typeof requireOrgModule>>, { ok: true }>, contractId: string) {
  const actor = await contractActor(access);
  const row = await readContractRow(access.admin, access.orgId, contractId);
  if (!row) return null;
  const links = (await linksOf(access.admin, access.orgId, [row.id])).get(row.id) ?? [];
  if (!mayReadContract(actor, { status: row.status, artist_contact_id: row.artist_contact_id, partyIds: links.map((l) => l.party_id) })) return null;
  const identities = await identitiesOf(access.admin, access.orgId, links.map((l) => l.party_id));
  return { actor, row, links, identities };
}

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
    return json(200, {
      contract: contractView(row, links, identities, readsAllContracts(actor)),
      document,
      canWrite: access.capabilities.has('contracts.write') && isEditable(row.status) && scopeAllowsContact(access.artistScope, row.artist_contact_id),
    });
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

    await saveContract(admin, org, access.userId, row.id, patch, parties);
    await recordEvent(admin, { orgId: org, userId: access.userId }, 'contract.updated', { ...subject, artistId: body.artist_contact_id !== undefined ? body.artist_contact_id : row.artist_contact_id }, { changed });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    if (err instanceof ContractSaveError) return json(err.kind === 'not_found' ? 404 : err.kind === 'not_draft' ? 409 : 400, { error: err.message });
    log.error('contract update failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not update the contract' });
  }
}
