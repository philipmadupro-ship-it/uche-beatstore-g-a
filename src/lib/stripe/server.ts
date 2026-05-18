import Stripe from 'stripe';

/**
 * Server-only Stripe client. Cached at module scope so we don't
 * spin up a new HTTPS agent per request — Stripe's SDK is already
 * a singleton inside the process.
 *
 * Pinning the API version keeps webhook signatures verifiable
 * across Node + Stripe upgrades: a bumped version on the dashboard
 * without a code change here would silently break signature
 * verification.
 */
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  // Let the SDK pick its bundled api version. Pinning a string here
  // requires keeping it in sync with the SDK's type literal, which
  // changes between minor versions of `stripe`; the SDK default is
  // what Stripe tested webhook signing against for this exact build.
  _stripe = new Stripe(key);
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}
