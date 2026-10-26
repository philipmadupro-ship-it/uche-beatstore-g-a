/**
 * POST /api/org/[orgId]/parties/[partyId]/confirm — the person a party names
 * confirms their own rights details (LABEL-54, "invite-to-confirm"), optionally
 * correcting the legal fields first: `{ legal_name?, ipi?, isni?, pro?,
 * pro_affiliation?, publisher_name?, publisher_ipi?, address?, country? }`.
 *
 * Only the party's own account, and only through an own-line ability
 * (`rights.read.own_line`): anyone else — a rights writer included — gets 404,
 * because nobody confirms for another person. The body is strict: identity
 * (display name, links) and payee data cannot be sent here. The event names the
 * fields that were corrected, never their values.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgPartyConfirmBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { CREDITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { mayReadPayee, orgActor, partyViewWithLink } from '@/lib/labelos/credits';
import { CreditsNotReadyError, markPartyConfirmed, readParty } from '@/lib/labelos/credits-store';
import { partyColumns, pickSelfCorrections } from '@/lib/labelos/parties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.parties.confirm');

type Params = { params: Promise<{ orgId: string; partyId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, partyId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Parties need Supabase.' });
  const access = await requireOrgCapability(orgId, 'rights.read.own_line');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgPartyConfirmBodySchema);
  if (!parsed.ok) return parsed.res;

  const corrections = partyColumns(pickSelfCorrections(parsed.data));
  if (!corrections.ok) return json(400, { error: corrections.error });
  const { admin, orgId: org } = access;

  try {
    const party = await readParty(admin, org, partyId);
    // Not their party: it does not exist for them.
    if (!party || party.user_id !== access.userId) return json(404, { error: 'Not found' });

    // The same view the list gave them: a rights writer confirming themselves keeps their link and payee block.
    const actor = orgActor(access.userId, access.capabilities, access.role);
    const updated = await markPartyConfirmed(admin, org, partyId, access.userId, corrections.columns, { payee: mayReadPayee(actor) });
    if (!updated) return json(404, { error: 'Not found' });

    await recordEvent(admin, { orgId: org, userId: access.userId }, 'party.confirmed', { type: 'party', id: partyId }, { corrected: Object.keys(corrections.columns).sort() });
    return json(200, { party: partyViewWithLink(updated, actor) });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('party confirm failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not confirm the details' });
  }
}
