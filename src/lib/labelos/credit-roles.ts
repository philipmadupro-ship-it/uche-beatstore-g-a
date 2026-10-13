/**
 * The credit role vocabulary (LABEL-27, 17 R8): what `track_collaborators.role`
 * may say on an ORG track, with RIN-aligned labels (the DDEX Recording
 * Information Notification names — Producer, Co-Producer, Mixer, Mastering
 * Engineer, Featured Artist, … — so a later delivery export is a lookup, not
 * a translation).
 *
 * A credit has a SCOPE: `composition` credits belong to the song as a work
 * (who wrote it), `recording` credits to a recording of it (who performed,
 * produced, engineered it). The scope is a property of the role, so a role
 * sent with the wrong scope is refused rather than stored half-meaningful.
 *
 * The producer app keeps writing its three free-text roles (115:
 * producer / feature / collaborator). They stay valid here and read as
 * recording credits, so a credit read from a filename on an org track needs
 * no translation. Pure; the route validates through `resolveCreditScope`.
 */

export const CREDIT_SCOPES = ['composition', 'recording'] as const;
export type CreditScope = (typeof CREDIT_SCOPES)[number];

export const CREDIT_STATUSES = ['proposed', 'confirmed', 'disputed'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export type CreditRoleDef = {
  key: string;
  label: string;
  scope: CreditScope;
  /** What `role_detail` should say for this role, when it is worth asking. */
  detail?: string;
  /** One of the three roles the producer app already writes (115). */
  legacy?: boolean;
};

export const CREDIT_ROLES: readonly CreditRoleDef[] = [
  // Composition — the work.
  { key: 'songwriter', label: 'Songwriter', scope: 'composition' },
  { key: 'composer', label: 'Composer', scope: 'composition' },
  { key: 'lyricist', label: 'Lyricist', scope: 'composition' },
  { key: 'arranger', label: 'Arranger', scope: 'composition' },
  // Recording — the take.
  { key: 'main_artist', label: 'Main Artist', scope: 'recording' },
  { key: 'feature', label: 'Featured Artist', scope: 'recording', legacy: true },
  { key: 'producer', label: 'Producer', scope: 'recording', legacy: true },
  { key: 'co_producer', label: 'Co-Producer', scope: 'recording' },
  { key: 'executive_producer', label: 'Executive Producer', scope: 'recording' },
  { key: 'vocalist', label: 'Vocalist', scope: 'recording' },
  { key: 'background_vocalist', label: 'Background Vocalist', scope: 'recording' },
  { key: 'instrumentalist', label: 'Instrumentalist', scope: 'recording', detail: 'Instrument' },
  { key: 'programmer', label: 'Programmer', scope: 'recording' },
  { key: 'recording_engineer', label: 'Recording Engineer', scope: 'recording' },
  { key: 'mixer', label: 'Mixer', scope: 'recording' },
  { key: 'mastering_engineer', label: 'Mastering Engineer', scope: 'recording' },
  { key: 'remixer', label: 'Remixer', scope: 'recording' },
  { key: 'collaborator', label: 'Collaborator', scope: 'recording', legacy: true },
];

const BY_KEY = new Map(CREDIT_ROLES.map((r) => [r.key, r]));

export function creditRole(key: string | null | undefined): CreditRoleDef | null {
  return typeof key === 'string' ? BY_KEY.get(key) ?? null : null;
}

export function isCreditRole(key: unknown): key is string {
  return typeof key === 'string' && BY_KEY.has(key);
}

export function rolesForScope(scope: CreditScope): CreditRoleDef[] {
  return CREDIT_ROLES.filter((r) => r.scope === scope);
}

/**
 * A role's label. A key the vocabulary does not know (a producer can type
 * anything, 115) passes through as written, tidied: `mixing_engineer` →
 * "Mixing engineer".
 */
export function creditRoleLabel(key: string): string {
  const def = creditRole(key);
  if (def) return def.label;
  const words = key.trim().replace(/[_-]+/g, ' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function isCreditScope(v: unknown): v is CreditScope {
  return typeof v === 'string' && (CREDIT_SCOPES as readonly string[]).includes(v);
}

export function isCreditStatus(v: unknown): v is CreditStatus {
  return typeof v === 'string' && (CREDIT_STATUSES as readonly string[]).includes(v);
}

export type ScopeResolution = { ok: true; scope: CreditScope } | { ok: false; error: string };

/**
 * The scope a proposed credit is stored with: the role's own. A caller may
 * name a scope, but only the role's — "Mixer on the composition" is a
 * mistake worth refusing, not a credit worth storing. An unknown role fails.
 */
export function resolveCreditScope(role: string, requested?: string | null): ScopeResolution {
  const def = creditRole(role);
  if (!def) return { ok: false, error: 'Unknown credit role' };
  if (requested !== undefined && requested !== null && requested !== def.scope) {
    return { ok: false, error: `${def.label} is a ${def.scope} credit` };
  }
  return { ok: true, scope: def.scope };
}
