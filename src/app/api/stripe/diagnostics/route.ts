import { NextResponse } from 'next/server';
import { isStripeConfigured, getStripe } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stripe/diagnostics
 *
 * Owner-gated health check — confirms each piece of the Stripe loop
 * is wired correctly without running an actual checkout. Useful for
 * "I set the env vars but I don't see the buy button" debugging.
 *
 * Returns a flat object of booleans + counts so the operator can
 * scan it at a glance. Never returns the secret values themselves —
 * just whether they're set and whether Stripe accepts them.
 *
 * Checks, in order:
 *   1. STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are set in env
 *   2. Stripe accepts the secret key (calls accounts.retrieve)
 *   3. Supabase is reachable and license_purchases exists
 *   4. The caller has at least one share with sales_enabled=true
 *      and a creator_profile with a non-null price (so something
 *      is actually buyable)
 *   5. Per-track override counts — how many tracks have explicit
 *      lease/exclusive prices set
 */
export async function GET() {
  const out: Record<string, any> = {
    env: {
      stripe_secret_key: !!process.env.STRIPE_SECRET_KEY,
      stripe_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
      app_url: process.env.NEXT_PUBLIC_APP_URL ?? null,
      resend_api_key: !!process.env.RESEND_API_KEY,
    },
    stripe: {
      configured: isStripeConfigured(),
      account_id: null as string | null,
      account_error: null as string | null,
    },
    supabase: {
      configured: isSupabaseConfigured(),
      // `null` until we actually probe — distinguishes "not yet
      // checked" (unauthenticated) from "checked and missing"
      // (authenticated but migration 019 didn't run).
      license_purchases_table: null as boolean | null,
      recent_purchases_count: 0,
    },
    seller: {
      authenticated: false,
      shares_for_sale: 0,
      profile_lease_price: null as number | null,
      profile_exclusive_price: null as number | null,
      tracks_with_price_override: 0,
    },
    hints: [] as string[],
  };

  // 1+2: Validate the secret key against Stripe's API.
  if (out.env.stripe_secret_key) {
    try {
      // Lighter probe than accounts.retrieve(): list at most one
      // balance transaction. Confirms the key is valid + the
      // account is reachable without needing the SDK's optional
      // params signature.
      const stripe = getStripe();
      await stripe.balance.retrieve();
      out.stripe.account_id = 'verified';
    } catch (err) {
      out.stripe.account_error = errorMessage(err);
      out.hints.push('Stripe rejected the secret key. Check STRIPE_SECRET_KEY in Vercel.');
    }
  } else {
    out.hints.push('STRIPE_SECRET_KEY not set in Vercel env.');
  }
  if (!out.env.stripe_webhook_secret) {
    out.hints.push('STRIPE_WEBHOOK_SECRET not set. Webhooks will be rejected with 400.');
  }
  if (!out.env.app_url || out.env.app_url.includes('localhost')) {
    out.hints.push('NEXT_PUBLIC_APP_URL is missing or set to localhost. Receipt URLs will be broken.');
  }
  if (!out.env.resend_api_key) {
    out.hints.push('RESEND_API_KEY missing — purchase receipt emails will be skipped (purchase still records).');
  }

  // 3+4+5: Supabase-side checks. Require a signed-in user so this
  // endpoint can show seller-scoped diagnostics.
  if (out.supabase.configured) {
    const auth = await requireUser();
    if (auth.ok) {
      out.seller.authenticated = true;
      const admin = createServiceClient();

      // Table existence + recent purchases count
      const { count, error: lpErr } = await admin
        .from('license_purchases')
        .select('*', { count: 'exact', head: true })
        .eq('seller_user_id', auth.userId);
      if (!lpErr) {
        out.supabase.license_purchases_table = true;
        out.supabase.recent_purchases_count = count ?? 0;
      } else {
        out.hints.push(`license_purchases table inaccessible: ${lpErr.message}. Run migration 019.`);
      }

      // Sales-enabled shares
      const { count: salesCount } = await admin
        .from('project_shares')
        .select('id, projects!inner(user_id)', { count: 'exact', head: true })
        .eq('projects.user_id', auth.userId)
        .eq('sales_enabled', true);
      out.seller.shares_for_sale = salesCount ?? 0;
      if (out.seller.shares_for_sale === 0) {
        out.hints.push('No shares currently for sale. Open the share modal → audience Client → flip "For sale" → generate.');
      }

      // Profile prices
      const { data: profile } = await admin
        .from('creator_profiles')
        .select('license_lease_price_usd, license_exclusive_price_usd')
        .eq('user_id', auth.userId)
        .maybeSingle();
      out.seller.profile_lease_price = profile?.license_lease_price_usd ?? null;
      out.seller.profile_exclusive_price = profile?.license_exclusive_price_usd ?? null;

      // Per-track overrides
      const { count: overrideCount } = await admin
        .from('tracks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', auth.userId)
        .or('lease_price_usd.not.is.null,exclusive_price_usd.not.is.null');
      out.seller.tracks_with_price_override = overrideCount ?? 0;

      if (
        out.seller.profile_lease_price == null &&
        out.seller.profile_exclusive_price == null &&
        out.seller.tracks_with_price_override === 0
      ) {
        out.hints.push('No prices set anywhere. Set defaults in /settings or per-track overrides on /library/[id].');
      }
    } else {
      out.hints.push('Sign in to see seller-scoped diagnostics.');
    }
  }

  return NextResponse.json(out, { status: 200 });
}
