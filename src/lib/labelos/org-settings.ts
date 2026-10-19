/**
 * Organization settings an owner can change (LABEL-51, doc 21 §2 item 3 and
 * §5.2 #5): the release gates' switches, the signed-split requirement, the
 * Needs-attention thresholds and which departments are on.
 *
 * The values live in `organizations.settings` (jsonb). Readers elsewhere
 * (`parseReadinessSettings`, `parseAttentionSettings`) are total and read only
 * their own keys; this module adds the owner-facing view, the department
 * switch and the pure plan for a change:
 *
 *  - A department switch only NARROWS. A department is on when the platform
 *    operator licensed it (lib/labelos/entitlements) AND the owner has not
 *    switched it off (`departments_off`). The owner cannot turn on what the
 *    licence does not include, so `effectiveModules` is always a subset of the
 *    licence.
 *  - `export` is not switchable: the owner's way to take their data out must
 *    not be one click from disappearing.
 *  - `legal_gate = 'off'` is an explicit, audited skip (decision 5): it skips
 *    only the legal APPROVAL, never `credits_splits`.
 *  - The change is the minimum: `planSettingsChange` returns only the keys
 *    that differ, and the event payload names those keys with their old and
 *    new values. Settings hold no free text, so no note can reach the log.
 */
import { parseAttentionSettings, parseReadinessSettings } from '@/lib/contracts';
import type { EventPayload } from './activity';
import { MODULES, type Module } from './entitlements';

/** Modules the owner may switch off (everything but the data export). */
export const SWITCHABLE_MODULES: readonly Module[] = MODULES.filter((m) => m !== 'export');

export const SETTING_KEYS = [
  'legal_gate',
  'marketing_gate',
  'require_signed_master_split',
  'attention_release_days',
  'attention_stalled_days',
  'departments_off',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type OrgSettingsView = {
  legal_gate: 'on' | 'off';
  marketing_gate: 'on' | 'off';
  require_signed_master_split: boolean;
  attention_release_days: number;
  attention_stalled_days: number;
  departments_off: Module[];
};

/** Total over any stored value: known, switchable, once each, in MODULES order. */
export function parseDepartmentsOff(raw: unknown): Module[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === 'string'));
  return SWITCHABLE_MODULES.filter((m) => wanted.has(m));
}

/** Total over any stored value: a missing or malformed key reads as its default. */
export function parseOrgSettings(raw: unknown): OrgSettingsView {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const readiness = parseReadinessSettings(obj);
  return {
    legal_gate: readiness.legal_gate,
    marketing_gate: readiness.marketing_gate,
    require_signed_master_split: readiness.require_signed_master_split,
    ...parseAttentionSettings(obj),
    departments_off: parseDepartmentsOff(obj.departments_off),
  };
}

/** The departments that are on: the licence minus what the owner switched off. A fresh set. */
export function effectiveModules(licensed: ReadonlySet<Module>, off: readonly Module[]): Set<Module> {
  const out = new Set<Module>();
  for (const m of licensed) if (!off.includes(m)) out.add(m);
  return out;
}

export type SettingsPatch = Partial<OrgSettingsView>;

export type SettingsPlan =
  | {
      ok: true;
      /** Only the keys that differ, as they will be stored. */
      patch: Record<string, unknown>;
      keys: SettingKey[];
      /** The audit payload: `{ keys, changes: { key: { from, to } } }`. */
      payload: EventPayload & { keys: SettingKey[] };
    }
  | { ok: false; error: string };

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What a settings request changes. `current` is the stored `settings` value
 * (any shape), `licensed` the modules the org's licence includes.
 */
export function planSettingsChange(input: {
  current: unknown;
  patch: SettingsPatch | Record<string, unknown>;
  licensed: ReadonlySet<Module>;
}): SettingsPlan {
  const before = parseOrgSettings(input.current);
  const wanted = input.patch as SettingsPatch;

  if (wanted.departments_off !== undefined) {
    const asked = parseDepartmentsOff(wanted.departments_off);
    // Switching off something already off is a no-op even if the licence has since lapsed.
    const outside = asked.filter((m) => !input.licensed.has(m) && !before.departments_off.includes(m));
    if (outside.length > 0) {
      return { ok: false, error: `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not part of this organization's licence, so it cannot be switched here.` };
    }
  }

  // Contracts & legal off while legal approval is required would leave a gate nobody can clear.
  // Only a request that touches one of the two is judged, so an org already in that state can still change other settings.
  if (wanted.legal_gate !== undefined || wanted.departments_off !== undefined) {
    const after = {
      legal_gate: wanted.legal_gate ?? before.legal_gate,
      departments_off: wanted.departments_off !== undefined ? parseDepartmentsOff(wanted.departments_off) : before.departments_off,
    };
    if (contractsLockout(after)) return { ok: false, error: CONTRACTS_NEED_LEGAL_OFF };
  }

  const patch: Record<string, unknown> = {};
  const changes: Record<string, { from: string | number | boolean | string[]; to: string | number | boolean | string[] }> = {};
  const keys: SettingKey[] = [];
  for (const key of SETTING_KEYS) {
    if (wanted[key] === undefined) continue;
    const to = key === 'departments_off' ? parseDepartmentsOff(wanted[key]) : wanted[key];
    const from = before[key];
    if (sameValue(from, to)) continue;
    patch[key] = to;
    changes[key] = { from: from as never, to: to as never };
    keys.push(key);
  }
  return { ok: true, patch, keys, payload: { keys, changes } };
}

/** The keys of `draft` that differ from `saved`: the body the screen PATCHes. */
export function patchFromDraft(saved: OrgSettingsView, draft: OrgSettingsView): SettingsPatch {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const a = key === 'departments_off' ? parseDepartmentsOff(saved[key]) : saved[key];
    const b = key === 'departments_off' ? parseDepartmentsOff(draft[key]) : draft[key];
    if (!sameValue(a, b)) out[key] = b;
  }
  return out as SettingsPatch;
}

/** The approval gates the owner has switched off (shown on every release they skip). */
export function skippedGates(settings: Pick<OrgSettingsView, 'legal_gate' | 'marketing_gate'>): ('legal' | 'marketing')[] {
  const out: ('legal' | 'marketing')[] = [];
  if (settings.legal_gate === 'off') out.push('legal');
  if (settings.marketing_gate === 'off') out.push('marketing');
  return out;
}

const GATE_WORDS = { legal: 'Legal approval', marketing: 'Marketing approval' } as const;

/**
 * The banner a release carries when the owner switched an approval off
 * (decision 5: shown on every release it affects). It states only the
 * CURRENT setting, so it is true on a draft and on a delivered release alike;
 * a cancelled release requires nothing and carries none. Null when nothing is
 * skipped.
 */
export function gateSkipNotice(skipped: readonly ('legal' | 'marketing')[], releaseState: string): string | null {
  if (skipped.length === 0 || releaseState === 'cancelled') return null;
  const names = skipped.map((g) => GATE_WORDS[g]).join(' and ');
  const verb = skipped.length === 1 ? 'is' : 'are';
  return releaseState === 'delivered'
    ? `${names} ${verb} switched off for this organization. Credits & splits still gate.`
    : `${names} ${verb} switched off for this organization, so this release does not need it. Credits & splits still gate. The owner can switch it back on in settings.`;
}

export const CONTRACTS_NEED_LEGAL_OFF =
  'Contracts & legal cannot be switched off while legal approval is still required: nobody could give it. Switch legal approval off as well.';

/** The state after the change would leave legal approval required with nobody able to give it. */
export function contractsLockout(state: Pick<OrgSettingsView, 'legal_gate' | 'departments_off'>): boolean {
  return state.legal_gate === 'on' && state.departments_off.includes('contracts');
}
