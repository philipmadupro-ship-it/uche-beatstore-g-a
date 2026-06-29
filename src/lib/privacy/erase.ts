import { createHash } from 'crypto';

/**
 * Buyer data erasure (GDPR / CCPA "right to be forgotten").
 *
 * Buyers have no account — their only PII is the email captured at checkout
 * (and the Stripe customer id) stored on purchase records. We must be able to
 * honour an erasure request, but we can't simply delete the rows: the producer
 * has a legitimate-interest / legal basis to retain the *transaction* (amount,
 * date, what was sold) for accounting and tax. So we **anonymise** instead —
 * strip the PII, keep the financial shell.
 *
 * The replacement email is a deterministic, irreversible pseudonym so the
 * record stays internally consistent (and a repeat erasure is a no-op) without
 * being able to recover the original address.
 */

export const ERASED_DOMAIN = 'erased.invalid';

/** Canonicalise an email for matching (Stripe stores lowercased). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deterministic, irreversible pseudonym for an erased buyer email. */
export function redactedEmailFor(email: string): string {
  const hash = createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 12);
  return `erased-${hash}@${ERASED_DOMAIN}`;
}

/** True once an email has been through erasure (so we never re-process it). */
export function isErasedEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${ERASED_DOMAIN}`);
}

export interface PurchaseErasurePatch {
  buyer_email: string;
  buyer_stripe_customer: null;
}

/** PII-stripping patch for a `license_purchases` row. */
export function buildPurchaseErasurePatch(email: string): PurchaseErasurePatch {
  return { buyer_email: redactedEmailFor(email), buyer_stripe_customer: null };
}
