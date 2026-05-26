import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStripe } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().min(1),
});

/**
 * POST /api/store/account/portal
 *
 * Opens a Stripe Customer Portal session for the buyer behind a verified
 * magic-link token. Looks up the most recent license_purchases row with
 * a non-null buyer_stripe_customer for that email, then mints a portal
 * session pointing back to /store/account/<token>.
 *
 * Returns 400 if the token is invalid, 404 if we have no Stripe customer
 * on file (the buyer hasn't completed a Stripe checkout yet — there's
 * literally nothing to show in the portal).
 */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 });
    }
    const claims = verifyBuyerToken(parsed.data.token);
    if (!claims) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Portal unavailable in offline mode' }, { status: 503 });
    }

    const admin = createServiceClient();
    const { data: row } = await admin
      .from('license_purchases')
      .select('buyer_stripe_customer')
      .eq('buyer_email', claims.email)
      .not('buyer_stripe_customer', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const customerId = (row as any)?.buyer_stripe_customer as string | null;
    if (!customerId) {
      return NextResponse.json(
        { error: 'No Stripe customer on file for this email yet' },
        { status: 404 },
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getAppUrl()}/store/account/${parsed.data.token}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
