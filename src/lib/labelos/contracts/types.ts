/**
 * The contract model's vocabulary (LABEL-57, doc 23 §D). Pure.
 *
 * Fourteen types, each with a starting template in `templates/`. The eight ids
 * the setup wizard stores as "what this organization works with" (LABEL-48,
 * `contract-types.ts`) keep their ids here; the other six are new. The wizard's
 * own list is NOT widened: migration 192's setup function holds that list, and
 * a stored id it does not know is refused. Every type has a template whether or
 * not the org ticked it.
 *
 * A contract has a lifecycle status. This task only creates drafts and voids;
 * `sent` (LABEL-58) and `signed` (LABEL-60) are in the vocabulary and the
 * transition table so those tasks add a route, not a new rule.
 */
export const TEMPLATE_TYPES = [
  { id: 'recording', label: 'Recording agreement' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'licence', label: 'Licence (sync / sample)' },
  { id: 'deal_360', label: '360 deal' },
  { id: 'producer', label: 'Producer agreement' },
  { id: 'beat_licence', label: 'Beat licence / lease' },
  { id: 'feature', label: 'Feature' },
  { id: 'co_publishing', label: 'Co-writing / co-publishing' },
  { id: 'management', label: 'Management' },
  { id: 'collaboration', label: 'Collaboration' },
  { id: 'session', label: 'Session / engineer' },
  { id: 'work_for_hire', label: 'Work made for hire' },
  { id: 'mixing_mastering', label: 'Mixing / mastering' },
  { id: 'nda', label: 'Non-disclosure (NDA)' },
] as const;

export type TemplateTypeId = (typeof TEMPLATE_TYPES)[number]['id'];

export const TEMPLATE_TYPE_IDS: readonly TemplateTypeId[] = TEMPLATE_TYPES.map((t) => t.id);

export const TEMPLATE_TYPE_LABELS: Readonly<Record<TemplateTypeId, string>> = Object.fromEntries(
  TEMPLATE_TYPES.map((t) => [t.id, t.label]),
) as Record<TemplateTypeId, string>;

export function isTemplateType(value: unknown): value is TemplateTypeId {
  return typeof value === 'string' && (TEMPLATE_TYPE_IDS as readonly string[]).includes(value);
}

/** The role a party plays in one contract. The SQL CHECK on `contract_parties.role` is this list. */
export const PARTY_ROLES = [
  'label',
  'artist',
  'featured',
  'producer',
  'manager',
  'publisher',
  'licensor',
  'licensee',
  'collaborator',
  'engineer',
  'client',
  'provider',
  'disclosing',
  'receiving',
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const PARTY_ROLE_LABELS: Readonly<Record<PartyRole, string>> = {
  label: 'Label',
  artist: 'Artist',
  featured: 'Featured artist',
  producer: 'Producer',
  manager: 'Manager',
  publisher: 'Publisher',
  licensor: 'Licensor',
  licensee: 'Licensee',
  collaborator: 'Collaborator',
  engineer: 'Engineer',
  client: 'Client',
  provider: 'Provider',
  disclosing: 'Disclosing party',
  receiving: 'Receiving party',
};

export function isPartyRole(value: unknown): value is PartyRole {
  return typeof value === 'string' && (PARTY_ROLES as readonly string[]).includes(value);
}

export const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'void'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Readonly<Record<ContractStatus, string>> = {
  draft: 'Draft',
  sent: 'Sent for signature',
  signed: 'Signed',
  void: 'Void',
};

/**
 * The only moves a contract makes. `draft → sent` is LABEL-58's route,
 * `sent → signed` is LABEL-60's; the table lives here so neither invents one.
 * A signed contract can still be voided (LABEL-60's supersede), a void one is final.
 * The SQL twin is `contracts_guard` (migration 176).
 */
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  draft: ['sent', 'void'],
  sent: ['signed', 'void'],
  signed: ['void'],
  void: [],
};

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/** What the contract routes of THIS task may do to the status: void it. Nothing else. */
export const STATUS_MOVES_HERE: readonly ContractStatus[] = ['void'];

/** Only a draft can be edited; later changes are LABEL-58's versions. */
export function isEditable(status: ContractStatus): boolean {
  return status === 'draft';
}

export function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === 'string' && (CONTRACT_STATUSES as readonly string[]).includes(value);
}
