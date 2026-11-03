/**
 * /api/org/[orgId]/finance/payees (LABEL-61).
 *
 *   GET   the payees the caller may read: `finance.read` (never a roster
 *         artist), inside their artist scope. The payment reference is sent
 *         only with `finance.write`.
 *   POST  make a payee of a rights holder (a `parties` row) `{ party_id, artist_contact_id,
 *         currency?, payment_reference? }`. `finance.write`. A member limited
 *         to some artists can only make a payee of a party that names one of
 *         them. The payee takes the party's roster contact AT THIS MOMENT as its
 *         artist and keeps it (a later change to the party moves nobody).
 *
 * The module is `finance`: an org not licensed for it answers 404. Events name
 * ids, never amounts, names or references. The app never moves money — there is
 * no payment route here or anywhere in this task.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgPayeeCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { FINANCE_NOT_READY, FinanceNotReadyError, insertPayee, listPayees, partyForPayee } from '@/lib/labelos/finance-store';
import { mayReadPaymentReference, payeeView } from '@/lib/labelos/finance/view';
import { looksLikeBankNumber } from '@/lib/labelos/payee';
import { payeeNames } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.payees');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  // A roster artist never holds finance.read; this is belt and braces for a hand-built override.
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  try {
    const reference = mayReadPaymentReference(access.capabilities);
    const rows = await listPayees(access.admin, access.orgId, access.artistScope, { reference });
    const names = await payeeNames(access.admin, access.orgId, rows.map((r) => r.id));
    return json(200, { schemaReady: true, canWrite: access.capabilities.has('finance.write'), payees: rows.map((r) => ({ ...payeeView(r, { reference }), name: names.get(r.id) ?? null })) });
  } catch (err) {
    if (err instanceof FinanceNotReadyError) return json(200, { schemaReady: false, canWrite: false, payees: [] });
    log.error('payee list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the payees' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  const parsed = await readBody(req, OrgPayeeCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  if (body.payment_reference && looksLikeBankNumber(body.payment_reference)) {
    return json(400, { error: 'Do not store account numbers here: write where finance keeps them ("wire details on file").' });
  }

  try {
    const party = await partyForPayee(access.admin, access.orgId, body.party_id);
    // 404 for a party outside the org AND for one outside a scoped member's artists: no oracle either way.
    if (!party) return json(404, { error: 'Party not found' });
    if (access.artistScope !== null && !(party.contact_id && scopeAllowsContact(access.artistScope, party.contact_id))) {
      return json(404, { error: 'Party not found' });
    }
    // The caller names the artist this payee is for; a party that stands for someone else now is a conflict, not a guess.
    if ((party.contact_id ?? null) !== body.artist_contact_id) return json(409, { error: 'That party’s artist has changed. Reload and try again.', code: 'party_contact_changed' });
    const result = await insertPayee(access.admin, access.orgId, access.userId, body, body.artist_contact_id);
    if ('changed' in result) return json(409, { error: 'That party’s artist has changed. Reload and try again.', code: 'party_contact_changed' });
    if ('duplicate' in result) return json(409, { error: 'That party is already a payee' });
    if ('invalid' in result) return json(400, { error: 'The payee details were refused (no account numbers; keep the reference short).' });

    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'payee.created',
      { type: 'payee', id: result.payee.id, artistId: result.payee.artist_contact_id },
      { hasArtist: result.payee.artist_contact_id !== null },
    );
    return json(201, { payee: payeeView(result.payee, { reference: mayReadPaymentReference(access.capabilities) }) });
  } catch (err) {
    if (err instanceof FinanceNotReadyError) return json(503, { error: FINANCE_NOT_READY });
    log.error('payee create failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not create the payee' });
  }
}
