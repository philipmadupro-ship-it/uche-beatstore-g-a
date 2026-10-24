/**
 * /api/org/[orgId]/parties — the org's rights identities (LABEL-27, 05 §3).
 *
 *   GET   the parties the caller may read. `rights.read`: the directory
 *         (a member limited to some artists reads only the parties credited on
 *         songs of their scope, 06 §3), each with legal name, IPI and PRO.
 *         An own line (`rights.read.own_line`): only their own party.
 *   POST  create a party `{ display_name, kind?, legal_name?, email?, ipi?,
 *         isni?, pro?, pro_affiliation?, publisher_name?, publisher_ipi?,
 *         contact_id?, user_id? }`. `rights.write`.
 *
 * Parties are NOT contacts (a buyer never has an IPI): `contact_id` only
 * links the same person to the CRM. `user_id` links an account — an org
 * member or an external member of one of the org's projects. IPI / ISNI are
 * normalised to one stored form and refused when they cannot be real.
 * One party per account per org (409).
 *
 * LABEL-54: a party also carries address, country, tax id and payment
 * instructions. Tax id / payment instructions are written with `rights.write`
 * and read only with `rights.write` or `finance.read` (`mayReadPayee`) — the
 * list says which of them this caller may see (`canSeePayee`). A roster
 * artist reads names only (no `legal` block on any party but their own).
 * Payment instructions are free text; an IBAN- or card-looking value is 400.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { readsDirectory, requirePartiesReader } from '@/lib/labelos/parties-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgPartyCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { CREDITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { mayReadPayee, orgActor, partyView } from '@/lib/labelos/credits';
import {
  accountBelongsToOrg,
  contactInOrg,
  CreditsNotReadyError,
  insertParty,
  linkableMembers,
  listParties,
  ownPartyRow,
  scopedPartyIds,
} from '@/lib/labelos/credits-store';
import { partyColumns } from '@/lib/labelos/parties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.parties');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Parties need Supabase.' });
  const access = await requirePartiesReader(orgId);
  if (!access.ok) return access.res;
  const actor = orgActor(access.userId, access.capabilities, access.role);
  // Tax id and payment instructions are loaded only for a reader who may have them.
  const read = { payee: mayReadPayee(actor) };
  const canWrite = access.capabilities.has('rights.write');
  try {
    let rows;
    if (readsDirectory(access.capabilities)) {
      rows = await listParties(access.admin, access.orgId, read);
      if (access.artistScope !== null) {
        const visible = new Set(await scopedPartyIds(access.admin, access));
        const own = await ownPartyRow(access.admin, access.orgId, access.userId);
        rows = rows.filter((p) => visible.has(p.id) || p.id === own?.id);
      }
    } else {
      const own = await ownPartyRow(access.admin, access.orgId, access.userId, read);
      rows = own ? [own] : [];
    }
    return json(200, {
      schemaReady: true,
      parties: rows.map((p) => partyView(p, actor)),
      canWrite,
      canSeePayee: read.payee,
      // Names only, so a rights writer can link a party to the account that will confirm it.
      ...(canWrite ? { members: await linkableMembers(access.admin, access.orgId) } : {}),
    });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(200, { schemaReady: false, parties: [], canWrite: false });
    log.error('party list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the parties' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Parties need Supabase.' });
  const access = await requireOrgCapability(orgId, 'rights.write');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgPartyCreateBodySchema);
  if (!parsed.ok) return parsed.res;

  const cols = partyColumns(parsed.data);
  if (!cols.ok) return json(400, { error: cols.error });
  const { admin, orgId: org } = access;

  try {
    if (parsed.data.contact_id && !(await contactInOrg(admin, org, parsed.data.contact_id))) return json(404, { error: 'Contact not found' });
    if (parsed.data.user_id && !(await accountBelongsToOrg(admin, org, parsed.data.user_id))) {
      return json(400, { error: 'That account is not a member of this organization or one of its projects' });
    }
    const result = await insertParty(admin, org, access.userId, cols.columns, { payee: true });
    if ('duplicate' in result) return json(409, { error: 'That account already has a party in this organization' });

    await recordEvent(admin, { orgId: org, userId: access.userId }, 'party.created', { type: 'party', id: result.party.id }, { kind: result.party.kind });
    return json(201, { party: partyView(result.party, orgActor(access.userId, access.capabilities, access.role)) });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('party create failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not create the party' });
  }
}
