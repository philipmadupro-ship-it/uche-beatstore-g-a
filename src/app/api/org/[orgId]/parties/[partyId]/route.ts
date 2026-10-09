/**
 * /api/org/[orgId]/parties/[partyId] — one rights identity (LABEL-27).
 *
 *   GET     one party, under the list's visibility rules (a party the caller
 *           may not read is 404, never 403).
 *   PATCH   change it (omitted keeps, '' / null clears). `rights.write`. A new
 *           display name follows into the party's credits, which carry it.
 *   DELETE  remove it. `rights.write`. A party named on credits is 409 — move
 *           or dispute the credits first; a credit is never orphaned silently.
 *
 * The events carry WHICH fields changed, never their values: the legal name
 * and IPI are not for the activity feed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgPartyPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { CREDITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { orgActor, partyView } from '@/lib/labelos/credits';
import {
  accountBelongsToOrg,
  contactInOrg,
  creditsOfParty,
  CreditsNotReadyError,
  deleteParty,
  readParty,
  scopedPartyIds,
  updateParty,
} from '@/lib/labelos/credits-store';
import { partyColumns } from '@/lib/labelos/parties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.parties.id');

type Params = { params: Promise<{ orgId: string; partyId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, partyId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Parties need Supabase.' });
  const access = await requireOrgCapability(orgId, 'rights.read.own_line');
  if (!access.ok) return access.res;
  try {
    const party = await readParty(access.admin, access.orgId, partyId);
    if (!party) return json(404, { error: 'Not found' });
    const own = party.user_id === access.userId;
    let readable = own;
    if (!readable && access.capabilities.has('rights.read')) {
      readable = access.artistScope === null || (await scopedPartyIds(access.admin, access)).includes(party.id);
    }
    if (!readable) return json(404, { error: 'Not found' });
    return json(200, { party: partyView(party, orgActor(access.userId, access.capabilities)) });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(404, { error: 'Not found' });
    log.error('party read failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the party' });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, partyId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Parties need Supabase.' });
  const access = await requireOrgCapability(orgId, 'rights.write');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgPartyPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const cols = partyColumns(parsed.data);
  if (!cols.ok) return json(400, { error: cols.error });
  const { admin, orgId: org } = access;

  try {
    if (!(await readParty(admin, org, partyId))) return json(404, { error: 'Not found' });
    if (parsed.data.contact_id && !(await contactInOrg(admin, org, parsed.data.contact_id))) return json(404, { error: 'Contact not found' });
    if (parsed.data.user_id && !(await accountBelongsToOrg(admin, org, parsed.data.user_id))) {
      return json(400, { error: 'That account is not a member of this organization or one of its projects' });
    }
    const result = await updateParty(admin, org, partyId, cols.columns);
    if ('missing' in result) return json(404, { error: 'Not found' });
    if ('duplicate' in result) return json(409, { error: 'That account already has a party in this organization' });

    await recordEvent(admin, { orgId: org, userId: access.userId }, 'party.updated', { type: 'party', id: partyId }, { fields: Object.keys(cols.columns).sort() });
    return json(200, { party: partyView(result.party, orgActor(access.userId, access.capabilities)) });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('party update failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not update the party' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, partyId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Parties need Supabase.' });
  const access = await requireOrgCapability(orgId, 'rights.write');
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access;

  try {
    if (!(await readParty(admin, org, partyId))) return json(404, { error: 'Not found' });
    const credits = await creditsOfParty(admin, org, partyId);
    if (credits > 0) return json(409, { error: `This party is named on ${credits} credit${credits === 1 ? '' : 's'}`, credits });
    if (!(await deleteParty(admin, org, partyId))) return json(404, { error: 'Not found' });

    await recordEvent(admin, { orgId: org, userId: access.userId }, 'party.deleted', { type: 'party', id: partyId }, {});
    return json(200, { deleted: true });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('party delete failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not delete the party' });
  }
}
