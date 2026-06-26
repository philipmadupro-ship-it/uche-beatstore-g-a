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
 *   - UUIDs are resolved against the `licenses` rows fetched from the DB.
 *   - Legacy string ids ('exclusive', 'exclusive-rights', 'lease', 'basic-lease',
 *     …) are normalised by name. Anything unrecognised falls back to 'lease'
 *     (the safe default — never auto-delist on an unknown id).
 */
export function resolveLicenseType(
  raw: string,
  licenseById: Map<string, LicenseLike>,
): LicenseType {
  if (isUUID(raw)) {
    const row = licenseById.get(raw);
    return row?.is_exclusive === true ? 'exclusive' : 'lease';
  }
  return raw === 'exclusive-rights' || raw === 'exclusive' ? 'exclusive' : 'lease';
}
