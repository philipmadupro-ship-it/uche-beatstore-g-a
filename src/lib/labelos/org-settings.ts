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
  return {
    ...parseReadinessSettings(obj),
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
