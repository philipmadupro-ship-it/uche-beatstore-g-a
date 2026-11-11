import { normalizeEmailOrNull } from '@/lib/contacts/email';

/**
 * Pure helpers that describe the payments + email configuration WITHOUT ever
 * returning a secret. Used by GET /api/stripe/diagnostics and by the webhook's
 * log lines, so the owner can tell why a paid sale produced no email.
 */

/** Dashboard pastes routinely carry a trailing newline or space. */
export function cleanEnv(raw: string | undefined | null): string {
  return (raw ?? '').trim();
}

export type StripeKeyMode = 'live' | 'test' | 'unknown' | 'missing';

export function stripeKeyMode(raw: string | undefined | null): StripeKeyMode {
  const key = cleanEnv(raw);
  if (!key) return 'missing';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

export function webhookSecretStatus(raw: string | undefined | null) {
  const value = raw ?? '';
  return {
    set: cleanEnv(value) !== '',
    looks_valid: /^whsec_\S+$/.test(cleanEnv(value)),
    has_whitespace: value !== value.trim(),
  };
}

export function fromDomain(from: string | undefined | null): string | null {
  const m = cleanEnv(from).match(/<?([^<>\s@]+@([^<>\s@]+\.[^<>\s@]+))>?$/);
  return m ? m[2].toLowerCase() : null;
}

export const RESEND_SANDBOX_SENDER = 'onboarding@resend.dev';

export function resendConfig(env: Record<string, string | undefined>) {
  const apiKey = cleanEnv(env.RESEND_API_KEY);
  const from = cleanEnv(env.RESEND_FROM_EMAIL);
  const domain = fromDomain(from);
  const sandbox = !from || domain === 'resend.dev';
  const problems: string[] = [];
  if (!apiKey) problems.push('RESEND_API_KEY is not set: no delivery email can be sent.');
  if (!from) {
    problems.push(
      `RESEND_FROM_EMAIL is not set, so mail goes from the Resend sandbox sender (${RESEND_SANDBOX_SENDER}), which Resend only delivers to the account owner. Buyers get nothing.`,
    );
  } else if (sandbox) {
    problems.push('RESEND_FROM_EMAIL is on resend.dev (sandbox): Resend only delivers it to the account owner. Use an address on a verified domain.');
  } else if (!domain) {
    problems.push('RESEND_FROM_EMAIL is not a valid address.');
  }
  return {
    api_key_set: apiKey !== '',
    from_set: from !== '',
    from_domain: domain,
    sandbox_sender: sandbox,
    problems,
  };
}

/**
 * Who a delivery email goes to. Metadata first, then Stripe's own
 * customer_email (set from the same value at checkout). The webhook's
 * 'unknown@invalid' placeholder is never a recipient.
 */
export function deliveryRecipient(
  metaEmail: string | null | undefined,
  customerEmail: string | null | undefined,
): string | null {
  const email = normalizeEmailOrNull(metaEmail) ?? normalizeEmailOrNull(customerEmail);
  return email && email !== 'unknown@invalid' ? email : null;
}

/** A pointer for the log line; the raw provider message is logged separately. */
export function emailFailureHint(message: string): string {
  const m = message.toLowerCase();
  if (/testing emails|your own email|resend\.dev/.test(m)) {
    return 'Sandbox sender: set RESEND_FROM_EMAIL to an address on a verified Resend domain.';
  }
  if (/domain.*(not|isn)|not verified|verify/.test(m)) {
    return 'The sender domain is not verified in Resend: add the DNS records and wait for Verified.';
  }
  if (/api key|unauthorized|restricted|invalid.*key|missing.*key/.test(m)) {
    return 'RESEND_API_KEY is missing, invalid or lacks sending access.';
  }
  return 'Check the Resend dashboard Logs for this send.';
}

export type DeliverySkipReason = 'resend_api_key_missing' | 'no_buyer_email';

/** Why a paid purchase's delivery email cannot be attempted at all, or null. */
export function deliverySkipReason(
  recipient: string | null,
  env: Record<string, string | undefined> = process.env,
): DeliverySkipReason | null {
  if (!cleanEnv(env.RESEND_API_KEY)) return 'resend_api_key_missing';
  if (!recipient) return 'no_buyer_email';
  return null;
}

/** Cross-checks that explain a live/test mix-up. Pure, never sees a secret value. */
export function modeHints(input: {
  secretKeyMode: StripeKeyMode;
  publishableKeyMode: StripeKeyMode;
  webhookSecret: ReturnType<typeof webhookSecretStatus>;
  endpointLivemode: boolean | null;
}): string[] {
  const hints: string[] = [];
  const { secretKeyMode, publishableKeyMode, webhookSecret, endpointLivemode } = input;
  if (secretKeyMode === 'unknown') hints.push('STRIPE_SECRET_KEY does not look like sk_live_… / sk_test_… (or a restricted rk_ key).');
  if (
    (secretKeyMode === 'live' && publishableKeyMode === 'test') ||
    (secretKeyMode === 'test' && publishableKeyMode === 'live')
  ) {
    hints.push(
      `STRIPE_SECRET_KEY is ${secretKeyMode} but NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is ${publishableKeyMode}: checkout cannot start. NEXT_PUBLIC_ values are baked in at build, so redeploy after changing it.`,
    );
  }
  if (webhookSecret.set && !webhookSecret.looks_valid) hints.push('STRIPE_WEBHOOK_SECRET does not look like a whsec_… signing secret.');
  if (webhookSecret.has_whitespace) hints.push('STRIPE_WEBHOOK_SECRET has leading/trailing whitespace (the webhook trims it, but re-paste it cleanly).');
  if (endpointLivemode === false && secretKeyMode === 'live') {
    hints.push('The registered webhook endpoint is a TEST-mode endpoint. Live payments need their own endpoint created with Stripe in Live mode.');
  }
  return hints;
}
