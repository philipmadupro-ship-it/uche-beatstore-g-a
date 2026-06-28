import { isUUID } from '@/lib/validate';

export type LicenseType = 'lease' | 'exclusive';

/** A license row as far as type resolution cares. */
export interface LicenseLike {
  is_exclusive?: boolean | null;
}

/**
 * Map a raw `license_id` (as it arrives in Stripe cart metadata) to a canonical
 * license_type. This is inventory-critical: an 'exclusive' result delists the
 * track so it can't be sold twice, so a misclassification either loses a sale
 * or sells an exclusive beat to two buyers.
 *
 *   - A UUID found in the `licenses` map resolves by its `is_exclusive` flag
 *     (the authoritative answer — the legacy hint is ignored here).
 *   - Otherwise (legacy string id, or a UUID not in the map) we fall back to
 *     name matching: 'exclusive' / 'exclusive-rights', or an optional
 *     `legacyTypeHint` the client sent alongside the id. Anything else is
 *     'lease' — the safe default, so we never auto-delist on an unknown id.
 *
 * The webhook calls this without a hint (so an unknown id is always 'lease');
 * checkout passes the cart item's legacy `license_type` as the hint.
 */
export function resolveLicenseType(
  raw: string,
  licenseById: Map<string, LicenseLike>,
  legacyTypeHint?: string | null,
): LicenseType {
  if (isUUID(raw)) {
    const row = licenseById.get(raw);
    if (row) return row.is_exclusive === true ? 'exclusive' : 'lease';
    // Unknown UUID — fall through to the legacy name/hint check below.
  }
  return raw === 'exclusive-rights' || raw === 'exclusive' || legacyTypeHint === 'exclusive'
    ? 'exclusive'
    : 'lease';
}
