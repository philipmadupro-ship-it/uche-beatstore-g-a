/**
 * A reviewable draft of the contract for one license tier (LICENSE-05).
 *
 * The same `buildLicenseContract` the Stripe webhook runs, with sample purchase
 * details, so what the producer reads is what a buyer of that tier gets. Pure:
 * the route supplies the tier row and the producer's wording; nothing here
 * reads or writes data. The view is built field by field, never from a spread
 * row, and carries no buyer data (the purchase details are the sample set).
 */
import {
  buildLicenseContract, purchaseDateLabel, resolveContractTiers, scheduleStart,
  type TermsSource, type Verification,
} from './license-contract';
import { SAMPLE_VARIABLES } from './license-template';

export const LEGACY_TIER_IDS = ['lease', 'exclusive'] as const;
export type LegacyTierId = (typeof LEGACY_TIER_IDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TierRef = { kind: 'uuid'; id: string } | { kind: 'legacy'; id: LegacyTierId } | null;

/** A route id as a tier reference: a uuid or one of the two legacy sample ids, nothing else. */
export function parseTierRef(id: string): TierRef {
  if (UUID_RE.test(id)) return { kind: 'uuid', id };
  if ((LEGACY_TIER_IDS as readonly string[]).includes(id)) return { kind: 'legacy', id: id as LegacyTierId };
  return null;
}

export interface TierDraftView {
  draft: true;
  /** purchase details in the text are samples, not a real buyer */
  sample: true;
  tier: { name: string; source: TermsSource; issues: string[] };
  template_source: 'producer' | 'tier-aware';
  markdown: string;
  schedule: string;
  verification: Verification;
  alerts: string[];
}

export const DRAFT_BANNER = '**DRAFT PREVIEW. Sample buyer and price. Not an issued contract.**';

export function buildTierDraft(input: {
  /** the producer's own `licenses` row, already owner-filtered; omit for a legacy sample id */
  tierRow?: Record<string, unknown> | null;
  legacyId?: LegacyTierId;
  /** wording to draft with: the saved template, or an unsaved edit */
  template: string | null | undefined;
  producerName?: string | null;
  producerEmail?: string | null;
  /** the day the draft is made, as a buyer's contract would be dated (tests pass a fixed one) */
  now?: Date;
}): TierDraftView {
  const row = input.tierRow ?? null;
  const isExclusive = row ? row.is_exclusive === true : input.legacyId === 'exclusive';
  const type = isExclusive ? 'exclusive' : 'lease';
  const licenseId = row ? String(row.id) : input.legacyId ?? type;
  const rows = row ? new Map([[licenseId, row]]) : null;
  const [tier] = resolveContractTiers([{ license_id: licenseId, license_type: type }], rows);
  const built = buildLicenseContract({
    template: input.template,
    vars: {
      ...SAMPLE_VARIABLES,
      purchase_date: purchaseDateLabel(input.now),
      license_type: tier.terms.is_exclusive ? 'Exclusive' : 'Lease',
      producer_name: input.producerName?.trim() || 'Producer',
      producer_email: input.producerEmail?.trim() || '',
    },
    tiers: [tier],
  });
  const at = scheduleStart(built.text);
  return {
    draft: true,
    sample: true,
    tier: { name: tier.terms.name, source: tier.source, issues: [...tier.issues] },
    template_source: built.snapshot.template_source,
    markdown: built.text,
    schedule: at === -1 ? '' : built.text.slice(at),
    verification: {
      ok: built.verification.ok,
      missing: [...built.verification.missing],
      contradicted: [...built.verification.contradicted],
    },
    alerts: [...built.alerts],
  };
}
