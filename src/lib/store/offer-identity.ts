/**
 * Whose offer is it? `POST /api/store/offer` is public, so the email on it is
 * only a claim — unless the caller holds a Supabase session, in which case the
 * session's email is the proof.
 *
 * "My beats" lists every offer stored under a signed-in buyer's address. If the
 * body's email were trusted, typing someone else's address would plant an offer
 * (price, status, title) in their account. So:
 *
 *   - a session with an email: that email is used, the body's is ignored, and
 *     the offer is recorded as verified;
 *   - no session (or a session with no email): the body's email is kept so the
 *     producer can still reply, and the offer is recorded as unverified;
 *   - "My beats" reads verified offers only (`buyer_email_verified`, mig 139).
 */
import { normalizeEmail } from '@/lib/contacts/email';

export interface OfferIdentity {
  /** Canonical (trimmed, lowercased) email the offer is stored under. */
  email: string;
  /** True only when the email came from the caller's own session. */
  verified: boolean;
}

export function resolveOfferIdentity(sessionEmail: string | null | undefined, bodyEmail: string): OfferIdentity {
  const proven = sessionEmail ? normalizeEmail(sessionEmail) : '';
  if (proven) return { email: proven, verified: true };
  return { email: normalizeEmail(bodyEmail), verified: false };
}

export const OFFER_VERIFIED_COLUMN = 'buyer_email_verified';

/**
 * PostgREST's answer when a query or write names `buyer_email_verified` before
 * migration 139 is applied: PGRST204 (write, schema cache) or 42703 (filter).
 * supabase-js RESOLVES with this error rather than throwing.
 */
export function isMissingOfferVerifiedColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code !== 'PGRST204' && e.code !== '42703') return false;
  return typeof e.message === 'string' && e.message.includes(OFFER_VERIFIED_COLUMN);
}
