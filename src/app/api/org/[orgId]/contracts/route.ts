/**
 * /api/org/[orgId]/contracts (LABEL-57).
 *
 *   GET   the contracts the caller may read (`mayReadContract`): `contracts.read`
 *         reads the org's, inside their artist scope; anyone else only the
 *         contracts that have left draft and name them (a party's account, or a
 *         roster artist's own contact). The internal note is for `contracts.read`.
 *   POST  start a DRAFT from a template `{ type, title, … }`. `contracts.write`.
 *         The text is a SNAPSHOT of the template version used: the org's latest
 *         saved version of the type, else the platform default (`source`
 *         forces one). A member limited to some artists can only start a
 *         contract for one of them.
 *
 * The module is `contracts`: an org not licensed for it answers 404. Payloads
 * of events name fields and kinds, never wording or amounts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { cleanFields } from '@/lib/labelos/contracts/merge-fields';
import { platformSource, platformTemplate } from '@/lib/labelos/contracts/templates';
import { type PartyRole } from '@/lib/labelos/contracts/types';
import { contractActor, viewsOf, visibleContracts } from '@/lib/labelos/contracts-route';
import {
  CONTRACTS_NOT_READY,
  ContractSaveError,
  ContractsNotReadyError,
  latestOrgTemplate,
  linkedInOrg,
  listContractRows,
  partiesInOrg,
  saveContract,
} from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts');
  if (!access.ok) return access.res;
  try {
    const actor = await contractActor(access);
    const rows = await listContractRows(access.admin, access.orgId);
    const loaded = await visibleContracts(access.admin, access.orgId, actor, rows);
    return json(200, { schemaReady: true, canWrite: access.capabilities.has('contracts.write'), contracts: viewsOf(loaded, actor) });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(200, { schemaReady: false, canWrite: false, contracts: [] });
    log.error('contract list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the contracts' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgContractCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const fields = cleanFields(body.fields ?? {});
  if (!fields.ok) return json(400, { error: fields.error });
  const def = platformTemplate(body.type);
  const slotRoles = new Set<PartyRole>(def.slots.map((s) => s.role));
  const parties = body.parties ?? [];
  const wrongRole = parties.find((p) => !slotRoles.has(p.role));
  if (wrongRole) return json(400, { error: `A ${def.name.toLowerCase()} has no "${wrongRole.role}" party` });
  const manyBad = def.slots.find((s) => !s.many && parties.filter((p) => p.role === s.role).length > 1);
  if (manyBad) return json(400, { error: `A ${def.name.toLowerCase()} has one ${manyBad.label.toLowerCase()}` });
  if (access.artistScope !== null && !scopeAllowsContact(access.artistScope, body.artist_contact_id ?? null)) {
    return json(403, { error: 'You can start contracts for your own artists only' });
  }

  const { admin, orgId: org } = access;
  try {
    const bad = await linkedInOrg(admin, org, { artist: body.artist_contact_id, track: body.track_id, release: body.release_id });
    if (bad) return json(404, { error: bad });
    if (!(await partiesInOrg(admin, org, parties.map((p) => p.party_id)))) return json(404, { error: 'A party was not found in this organization' });

    const own = body.source === 'platform' ? null : await latestOrgTemplate(admin, org, body.type);
    const snapshot = own
      ? { template_id: own.id, template_source: `org:${own.version}`, template_version: own.version, clauses: own.clauses }
      : { template_id: null, template_source: platformSource(body.type), template_version: def.version, clauses: def.clauses };

    const id = await saveContract(
      admin,
      org,
      access.userId,
      null,
      {
        type: body.type,
        title: body.title,
        ...snapshot,
        artist_contact_id: body.artist_contact_id ?? null,
        track_id: body.track_id ?? null,
        release_id: body.release_id ?? null,
        effective_date: body.effective_date ?? null,
        term_months: body.term_months ?? null,
        territories: body.territories ?? null,
        fields: fields.fields,
        internal_note: body.internal_note ?? null,
      },
      parties.map((p, i) => ({ party_id: p.party_id, role: p.role, position: i })),
    );

    await recordEvent(
      admin,
      { orgId: org, userId: access.userId },
      'contract.created',
      { type: 'contract', id, artistId: body.artist_contact_id ?? null, songId: body.track_id ?? null, releaseId: body.release_id ?? null },
      { type: body.type, source: snapshot.template_source, fields: Object.keys(fields.fields), party_roles: parties.map((p) => p.role) },
    );
    return json(201, { id });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    if (err instanceof ContractSaveError) return json(err.kind === 'invalid' ? 400 : 409, { error: err.message });
    log.error('contract create failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not create the contract' });
  }
}
