/**
 * POST /api/org/[orgId]/contracts/[contractId]/preview — the contract as the
 * form describes it right now, rendered by the SERVER (LABEL-58). Nothing is
 * saved. The live preview is this call, so the screen, the sent text and the
 * PDF are filled by the same renderer from the same party identities (only a
 * party's name and address are ever merged; the browser never receives the
 * identity rows). `contracts.write`, a draft, inside the caller's artist scope.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractPreviewBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { cleanContractClauses } from '@/lib/labelos/contracts/clause-edit';
import { renderContext, type ContractPartyLink } from '@/lib/labelos/contracts/context';
import { cleanFields } from '@/lib/labelos/contracts/merge-fields';
import { renderClauses } from '@/lib/labelos/contracts/render';
import { platformTemplate } from '@/lib/labelos/contracts/templates';
import { isEditable, type PartyRole } from '@/lib/labelos/contracts/types';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { CONTRACTS_NOT_READY, ContractsNotReadyError, identitiesOf, linkedNames } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.preview');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; contractId: string }> }) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return json(404, { error: 'Contract not found' });
  const parsed = await readBody(req, OrgContractPreviewBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const { admin, orgId: org } = access;

  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return json(404, { error: 'Contract not found' });
    const { row } = loaded;
    if (!isEditable(row.status)) return json(409, { error: 'Only a draft is previewed; read a sent contract as it was sent' });

    const fields = body.fields === undefined ? { ok: true as const, fields: row.fields } : cleanFields(body.fields);
    if (!fields.ok) return json(400, { error: fields.error });
    const clauses = body.clauses === undefined ? { ok: true as const, clauses: row.clauses } : cleanContractClauses(body.clauses);
    if (!clauses.ok) return json(400, { error: clauses.error });

    let links: ContractPartyLink[] = loaded.links;
    if (body.parties !== undefined) {
      const roles = new Set<PartyRole>(platformTemplate(row.type).slots.map((s) => s.role));
      const wrong = body.parties.find((p) => !roles.has(p.role));
      if (wrong) return json(400, { error: `This contract has no "${wrong.role}" party` });
      links = body.parties.map((p, i) => ({ party_id: p.party_id, role: p.role, position: i }));
    }
    const identities = body.parties === undefined ? loaded.identities : await identitiesOf(admin, org, links.map((l) => l.party_id));
    if (links.some((l) => !identities.has(l.party_id))) return json(404, { error: 'A party was not found in this organization' });

    const view = {
      title: body.title ?? row.title,
      effective_date: body.effective_date !== undefined ? body.effective_date : row.effective_date,
      term_months: body.term_months !== undefined ? body.term_months : row.term_months,
      territories: body.territories !== undefined ? body.territories : row.territories,
      fields: fields.fields,
    };
    const names = await linkedNames(admin, org, {
      artist_contact_id: body.artist_contact_id !== undefined ? body.artist_contact_id : row.artist_contact_id,
      track_id: body.track_id !== undefined ? body.track_id : row.track_id,
      release_id: body.release_id !== undefined ? body.release_id : row.release_id,
    });
    const document = renderClauses(clauses.clauses, renderContext({ row: view, links, identities, ...names }));
    return json(200, { document });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    log.error('contract preview failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not preview the contract' });
  }
}
