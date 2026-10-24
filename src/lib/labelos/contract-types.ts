/**
 * The contract types an organization says it works with (LABEL-48, step 2 of
 * the setup wizard; doc 22 §2).
 *
 * Only the CHOICE is stored, as `organizations.settings.contract_types`
 * (an additive key of LABEL-51's settings contract). Templates for each type
 * are LABEL-57 and are not built: nothing reads this list yet except the
 * settings screen that edits it, so a type picked now simply waits for its
 * template. The ids are stable (they are stored); the labels are copy.
 */
export const CONTRACT_TYPES = [
  { id: 'recording', label: 'Recording agreement' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'licence', label: 'Licence' },
  { id: 'deal_360', label: '360 deal' },
  { id: 'producer', label: 'Producer agreement / work for hire' },
  { id: 'feature', label: 'Feature' },
  { id: 'co_publishing', label: 'Co-publishing' },
  { id: 'management', label: 'Management' },
] as const;

export type ContractTypeId = (typeof CONTRACT_TYPES)[number]['id'];

export const CONTRACT_TYPE_IDS: readonly ContractTypeId[] = CONTRACT_TYPES.map((t) => t.id);

export const CONTRACT_TYPE_LABELS: Readonly<Record<ContractTypeId, string>> = Object.fromEntries(
  CONTRACT_TYPES.map((t) => [t.id, t.label]),
) as Record<ContractTypeId, string>;

export const TEMPLATES_LATER = 'Templates for these come later. Picking a type now only records what you work with.';

/** Total over any stored value: known ids, once each, in vocabulary order. */
export function parseContractTypes(raw: unknown): ContractTypeId[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === 'string'));
  return CONTRACT_TYPE_IDS.filter((id) => wanted.has(id));
}
