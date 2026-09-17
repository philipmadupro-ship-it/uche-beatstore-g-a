/**
 * Canonical buyer/contact email normalisation.
 *
 * Every row that links a human to the CRM keys on email: `contacts.email`,
 * `license_purchases.buyer_email`, `buyer_favorites.email`,
 * `store_free_downloads.email`. Those links only hold if every writer and
 * every reader agree on the canonical form — and they didn't. Checkout wrote
 * `.trim()` only while `/api/store/orders` and the contact activity timeline
 * both read `.toLowerCase().trim()`, so a buyer who typed `Foo@Bar.com` got a
 * purchase row no lookup could find.
 *
 * `contacts_user_email_uniq` (mig 096) is a plain b-tree on (user_id, email),
 * so it is case-SENSITIVE: without normalising at write time the same human
 * lands in the CRM twice.
 *
 * Rule: normalise on every write, and on every read used as a lookup key.
 */

/** Canonical form for matching: trimmed + lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Nullable-tolerant variant for optional columns. */
export function normalizeEmailOrNull(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const normalized = normalizeEmail(email);
  return normalized.length > 0 ? normalized : null;
}
