/**
 * POST /api/org/[orgId]/parties/[partyId]/invite — ask the person a party
 * names to confirm their rights details (LABEL-54, "invite-to-confirm").
 * `rights.write`. No body.
 *
 * The ask is one direct-ask notification (`party_confirmation`) to the ONE
 * account linked to the party, who then opens the Parties page, checks their
 * details and confirms (or corrects) them. A party with no linked account has
 * nobody to ask: 409 `no_account` says to link a member first. A party that is
 * already confirmed is 409 too. The asker never receives their own ask.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { CREDITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { CreditsNotReadyError, isOrgMember, readParty } from '@/lib/labelos/credits-store';
import { notifyDirectAsk } from '@/lib/labelos/notify';
import { askerName } from '@/lib/labelos/tasks-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.parties.invite');

type Params = { params: Promise<{ orgId: string; partyId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, partyId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Parties need Supabase.' });
  const access = await requireOrgCapability(orgId, 'rights.write');
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access;

  try {
    const party = await readParty(admin, org, partyId);
    if (!party) return json(404, { error: 'Not found' });
    if (!party.user_id) {
      return json(409, { error: 'Link this party to a member of the organization first, so there is someone to ask.', code: 'no_account' });
    }
    if (party.details_confirmed_at) return json(409, { error: 'These details are already confirmed.', code: 'already_confirmed' });
    // A person in the org's projects only has no bell here: the ask needs an org member.
    if (!(await isOrgMember(admin, org, party.user_id))) return json(409, { error: 'That account is not a member of the organization, so it cannot be asked here.', code: 'not_a_member' });

    await notifyDirectAsk(admin, {
      kind: 'party_confirmation',
      orgId: org,
      recipientId: party.user_id,
      actorId: access.userId,
      actorName: await askerName(admin, org, access.userId),
      subject: party.display_name,
      data: { partyId },
    });
    await recordEvent(admin, { orgId: org, userId: access.userId }, 'party.confirmation_requested', { type: 'party', id: partyId }, {});
    return json(200, { asked: true });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('party invite failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not send the request' });
  }
}
