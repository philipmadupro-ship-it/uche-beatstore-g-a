import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { ErasureRequestSchema } from '@/lib/contracts';
import { normalizeEmail, buildPurchaseErasurePatch } from '@/lib/privacy/erase';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.privacy.erase');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Buyer data-erasure (GDPR / CCPA "right to be forgotten").
 *
 * Producer-initiated: the buyer has no account, so they email the producer
 * (the data controller) asking to be forgotten, and the producer triggers this
 * for their own records. We scope every write to the authed `seller_user_id`,
 * so one producer can never erase another's data.
 *
 * We anonymise rather than delete: the transaction (amount, date, what sold)
 * is retained for the producer's legitimate accounting/tax basis, while the
 * PII (buyer email + Stripe customer id) is stripped. See `lib/privacy/erase`.
 *
 * Idempotent: re-running maps the (already-gone) email to the same pseudonym,
 * matches nothing, and reports zero rows — never an error.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ErasureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const patch = buildPurchaseErasurePatch(email);

  try {
    // license_purchases — strip email + Stripe customer, keep the financial row.
    const { data: lp, error: lpErr } = await admin
      .from('license_purchases')
      .update(patch)
      .eq('seller_user_id', userId)
      .eq('buyer_email', email)
      .select('id');
    if (lpErr) throw lpErr;

    // project_access_links — only carries the email (no stripe customer col).
    const { data: pal, error: palErr } = await admin
      .from('project_access_links')
      .update({ buyer_email: patch.buyer_email })
      .eq('seller_user_id', userId)
      .eq('buyer_email', email)
      .select('id');
    if (palErr) throw palErr;

    const licensePurchases = lp?.length ?? 0;
    const projectAccessLinks = pal?.length ?? 0;
    // Audit the action — never log the raw email (that's the PII we're erasing).
    log.info('buyer data erased', { sellerUserId: userId, licensePurchases, projectAccessLinks });

    return NextResponse.json({ erased: true, licensePurchases, projectAccessLinks });
  } catch (err) {
    log.error('erasure failed', { sellerUserId: userId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
