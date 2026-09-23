import { createHash } from 'crypto';
import { normalizeEmail } from '@/lib/contacts/email';

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

/** Canonicalise an email for matching. Re-exported from the shared helper so
 * erasure and the CRM link can never drift apart on what "same buyer" means. */
export { normalizeEmail };

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

/**
 * Everything the erasure touches, as data. The route runs these in order; the
 * test suite asserts the list, so a new table that stores buyer email has one
 * place to be added.
 *
 * - `anonymise`: the row is a business record (a sale, an offer, the CRM
 *   contact) — replace the email with the pseudonym and null the other PII.
 * - `delete`: the row exists only because of the person (favourites, follows,
 *   an unfinished cart) — there is nothing to keep once they are gone.
 *
 * `scope` is the column holding the producer's user id. Null means the table
 * is keyed on email alone (the buyer-account tables, drop subscriptions, free
 * downloads). Those are single-producer by design; the route must only run
 * this for a verified producer (`requireProducer`).
 */
export type ErasureStep = {
  table: string;
  action: 'anonymise' | 'delete';
  emailColumn: string;
  scope: string | null;
  patch?: Record<string, unknown>;
  /** Extra equality / inequality filter, e.g. only unsent jobs. */
  where?: { column: string; op: 'eq' | 'neq'; value: string };
  /** Response key the row count is reported under. */
  key: string;
};

export const ERASED_CONTACT_NAME = 'Erased buyer';

export function buildErasurePlan(email: string): ErasureStep[] {
  const pseudonym = redactedEmailFor(email);
  return [
    { key: 'licensePurchases', table: 'license_purchases', action: 'anonymise', emailColumn: 'buyer_email', scope: 'seller_user_id',
      patch: buildPurchaseErasurePatch(email) as unknown as Record<string, unknown> },
    { key: 'projectAccessLinks', table: 'project_access_links', action: 'anonymise', emailColumn: 'buyer_email', scope: 'seller_user_id',
      patch: { buyer_email: pseudonym } },
    { key: 'offers', table: 'buyer_offers', action: 'anonymise', emailColumn: 'buyer_email', scope: 'seller_user_id',
      patch: { buyer_email: pseudonym, message: null } },
    // An unsent delivery email would otherwise retry against the pseudonym
    // until it dies; retire it now. Sent ones keep their status for the record.
    { key: 'pendingEmails', table: 'fulfillment_email_jobs', action: 'anonymise', emailColumn: 'buyer_email', scope: 'seller_user_id',
      where: { column: 'status', op: 'neq', value: 'sent' },
      patch: { buyer_email: pseudonym, html: '', status: 'dead', last_error: 'Buyer data erased' } },
    { key: 'sentEmails', table: 'fulfillment_email_jobs', action: 'anonymise', emailColumn: 'buyer_email', scope: 'seller_user_id',
      where: { column: 'status', op: 'eq', value: 'sent' },
      patch: { buyer_email: pseudonym, html: '' } },
    { key: 'contacts', table: 'contacts', action: 'anonymise', emailColumn: 'email', scope: 'user_id',
      patch: {
        email: pseudonym, name: ERASED_CONTACT_NAME, phone: null, instagram: null, twitter: null,
        website: null, city: null, country: null, notes: null,
      } },
    // The comment stays (it is part of the beat's public thread); who wrote it goes.
    { key: 'comments', table: 'beat_comments', action: 'anonymise', emailColumn: 'author_email', scope: 'seller_user_id',
      patch: { author_email: null, author_name: 'Anonymous' } },
    { key: 'abandonedCarts', table: 'abandoned_carts', action: 'delete', emailColumn: 'buyer_email', scope: 'seller_user_id' },
    { key: 'follows', table: 'producer_follows', action: 'delete', emailColumn: 'email', scope: 'producer_user_id' },
    { key: 'dropSubscriptions', table: 'drop_subscribers', action: 'delete', emailColumn: 'email', scope: null },
    { key: 'freeDownloads', table: 'store_free_downloads', action: 'delete', emailColumn: 'email', scope: null },
    { key: 'favorites', table: 'buyer_favorites', action: 'delete', emailColumn: 'email', scope: null },
    { key: 'listeningHistory', table: 'buyer_listening_history', action: 'delete', emailColumn: 'email', scope: null },
    // buyer_playlist_tracks cascades from the playlist.
    { key: 'playlists', table: 'buyer_playlists', action: 'delete', emailColumn: 'email', scope: null },
  ];
}

