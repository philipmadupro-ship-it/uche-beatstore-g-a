/**
 * The validated shape of a license tier's terms (LICENSE-04).
 *
 * A contract is generated ONLY from a value that passed `TierTermsSchema`.
 * Nothing here coerces: a limit that is NaN, negative, zero or a string is
 * rejected, never read as "Unlimited", and a file type outside the License
 * Builder's list is rejected, never dropped. Callers decide the fallback and
 * record that they used one (see `resolveContractTiers` in license-contract.ts).
 *
 * Pure. Imports only zod and the TierTerms type.
 */
import { z } from 'zod';
import type { TierTerms } from './license-terms';

/** The License Builder's file options (components/store/LicenseBuilder.tsx) plus AIFF, which uploads accept. */
export const LICENSE_FILE_TYPES = ['MP3', 'WAV', 'FLAC', 'AIFF', 'STEMS', 'MIDI', 'PROJECT'] as const;

const limit = z.number().int().positive().max(1_000_000_000).nullable();

export const TierTermsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  file_types: z.array(z.enum(LICENSE_FILE_TYPES)).max(LICENSE_FILE_TYPES.length),
  stems_included: z.boolean(),
  is_exclusive: z.boolean(),
  streaming_limit: limit,
  distribution_limit: limit,
  commercial_rights: z.boolean().nullable(),
  sync_rights: z.boolean().nullable(),
  broadcast_rights: z.boolean().nullable(),
  credit_required: z.boolean(),
}).strict();

export const TERMS_SNAPSHOT_VERSION = 1;

export type ParsedTerms = { ok: true; terms: TierTerms } | { ok: false; issues: string[] };

/** Validate an unknown value as a tier's terms. File types are trimmed and upper-cased first (that is formatting, not coercion of meaning). */
export function parseTierTerms(raw: unknown): ParsedTerms {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, issues: ['terms is not an object'] };
  const o = raw as Record<string, unknown>;
  const candidate = {
    ...o,
    file_types: Array.isArray(o.file_types)
      ? [...new Set(o.file_types.map((t) => (typeof t === 'string' ? t.trim().toUpperCase() : t)))]
      : o.file_types,
  };
  const r = TierTermsSchema.safeParse(candidate);
  if (r.success) return { ok: true, terms: r.data };
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || 'terms'}: ${i.message}`) };
}
