import { NextResponse } from 'next/server';
import { isStripeConfigured, getStripe } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { requireProducer } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import {
  cleanEnv,
  modeHints,
  resendConfig,
  stripeKeyMode,
  webhookSecretStatus,
  type StripeKeyMode,
} from '@/lib/stripe/payments-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StripeDiagnostics {
  env: {
    stripe_secret_key: boolean;
    stripe_webhook_secret: boolean;
    webhook_secret: { set: boolean; looks_valid: boolean; has_whitespace: boolean };
    app_url: string | null;
    resend_api_key: boolean;
  };
  resend: ReturnType<typeof resendConfig>;
  fulfillment?: {
    failed_email_jobs: number | null;
    dead_email_jobs: number | null;
    paid_without_email_7d: number | null;
  };
  stripe: {
    key_mode: StripeKeyMode;
    publishable_key_mode: StripeKeyMode;
    configured: boolean;
    account_id: string | null;
    account_error: string | null;
  };
  supabase: {
    configured: boolean;
    license_purchases_table: boolean | null;
    recent_purchases_count: number;
  };
  seller: {
    authenticated: boolean;
    shares_for_sale: number;
    profile_lease_price: number | null;
    profile_exclusive_price: number | null;
    tracks_with_price_override: number;
  };
  webhook?: {
    endpoint_registered: boolean;
    livemode: boolean | null;
    url: string | null;
    status: string | null;
    missing_events: string[];
    error: string | null;
  };
  hints: string[];
}

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
  // Owner-only. It calls Stripe with the live secret key and reveals the
  // webhook URL and mail configuration, so a stranger gets nothing.
  const gate = await requireProducer();
  if (!gate.ok) return gate.res;

  const secretMode = stripeKeyMode(process.env.STRIPE_SECRET_KEY);
  const publishableMode = stripeKeyMode(
    cleanEnv(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).replace(/^pk_/, 'sk_'),
  );
  const webhookSecret = webhookSecretStatus(process.env.STRIPE_WEBHOOK_SECRET);
  const out: StripeDiagnostics = {
    env: {
      stripe_secret_key: !!cleanEnv(process.env.STRIPE_SECRET_KEY),
      stripe_webhook_secret: webhookSecret.set,
      webhook_secret: webhookSecret,
      app_url: process.env.NEXT_PUBLIC_APP_URL ?? null,
      resend_api_key: !!cleanEnv(process.env.RESEND_API_KEY),
    },
    resend: resendConfig(process.env),
    stripe: {
      key_mode: secretMode,
      publishable_key_mode: publishableMode,
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
  out.hints.push(...out.resend.problems);

  // 2b: Confirm a Stripe webhook endpoint is actually registered for the
  // events we handle (charge.dispute.closed restores access when a dispute is won). This turns "is the dashboard set up?" from a manual
  // checklist into a programmatic check — a paid sale with no registered
  // webhook never fulfils.
  const REQUIRED_EVENTS = ['checkout.session.completed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'];
  out.webhook = {
    endpoint_registered: false,
    livemode: null as boolean | null,
    url: null as string | null,
    status: null as string | null,
    missing_events: REQUIRED_EVENTS.slice(),
    error: null as string | null,
  };
  if (out.stripe.account_id === 'verified') {
    try {
      const stripe = getStripe();
      const eps = await stripe.webhookEndpoints.list({ limit: 100 });
      const ours = eps.data.find((e) => e.url?.includes('/api/stripe/webhook'));
      if (ours) {
        out.webhook.endpoint_registered = true;
        out.webhook.url = ours.url;
        out.webhook.livemode = typeof ours.livemode === 'boolean' ? ours.livemode : null;
        out.webhook.status = ours.status;
        // '*' means the endpoint is subscribed to all events.
        const enabled = new Set(ours.enabled_events);
        const missing = enabled.has('*') ? [] : REQUIRED_EVENTS.filter((e) => !enabled.has(e));
        out.webhook.missing_events = missing;
        if (ours.status !== 'enabled') {
          out.hints.push(`Stripe webhook endpoint is "${ours.status}", not "enabled".`);
        }
        if (missing.length) {
          out.hints.push(`Stripe webhook is missing events: ${missing.join(', ')}.`);
        }
      } else {
        out.hints.push(`No Stripe webhook endpoint points at /api/stripe/webhook. Add one in the Stripe dashboard subscribed to: ${REQUIRED_EVENTS.join(', ')}.`);
      }
    } catch (err) {
      // Restricted keys can't list webhook endpoints — not fatal.
      out.webhook.error = errorMessage(err);
    }
  }

  out.hints.push(...modeHints({
    secretKeyMode: secretMode,
    publishableKeyMode: publishableMode,
    webhookSecret,
    endpointLivemode: out.webhook.livemode,
  }));
  if (secretMode === 'live' && out.stripe.account_id === 'verified' && !out.webhook.endpoint_registered && !out.webhook.error) {
    out.hints.push('The live key lists NO webhook endpoint: Stripe test and live mode have separate endpoints. Create one in Live mode.');
  }

  // 3+4+5: Supabase-side checks. Require a signed-in user so this
  // endpoint can show seller-scoped diagnostics.
  if (out.supabase.configured) {
    const auth = gate;
    if (auth.ok) {
      out.seller.authenticated = true;
      const admin = createServiceClient();

      // Fulfilment health: a paid sale whose email never went out shows up
      // here even when nobody saw the log line.
      try {
        const [failed, dead, unsent] = await Promise.all([
          admin.from('fulfillment_email_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
          admin.from('fulfillment_email_jobs').select('id', { count: 'exact', head: true }).eq('status', 'dead'),
          admin.from('license_purchases').select('id', { count: 'exact', head: true })
            .eq('seller_user_id', auth.userId)
            .eq('status', 'paid')
            .eq('fulfillment_email_sent', false)
            .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
        ]);
        out.fulfillment = {
          failed_email_jobs: failed.error ? null : failed.count ?? 0,
          dead_email_jobs: dead.error ? null : dead.count ?? 0,
          paid_without_email_7d: unsent.error ? null : unsent.count ?? 0,
        };
        if ((out.fulfillment.paid_without_email_7d ?? 0) > 0 || (out.fulfillment.failed_email_jobs ?? 0) > 0 || (out.fulfillment.dead_email_jobs ?? 0) > 0) {
          out.hints.push(
            'Some paid purchases have no delivery email yet (see fulfillment counts). Fix the Resend config, then use /api/sales/resend per sale; failed jobs retry via /api/cron/process-fulfillment-emails.',
          );
        }
      } catch {
        /* diagnostics must never throw */
      }

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
