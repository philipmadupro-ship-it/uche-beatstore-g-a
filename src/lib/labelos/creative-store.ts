/**
 * Small reads behind the artistic direction workspace (LABEL-68) that more than one route needs. Service role, an org
 * filter on every query; authorisation is the route's.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { loadEntitlements } from './entitlements-store';
import { effectiveModules, parseDepartmentsOff } from './org-settings';
import { parseReadinessSettings } from '@/lib/contracts';

/**
 * Does the org have the `artistic` department — licensed by the platform operator AND not switched off by the owner? The
 * same rule `readMembership` applies when it strips `creative.*`. The creative gate means nothing, and must block
 * nothing, without it: the workspace and the gate's approval are 404 there, so a release could never satisfy it.
 */
export async function orgHasArtistic(admin: AdminClient, orgId: string): Promise<boolean> {
  const res = await admin.from('organizations').select('id, kind, settings').eq('id', orgId).maybeSingle();
  if (res.error) throw new Error(`org read: ${res.error.message}`);
  const org = res.data as { id: string; kind: string; settings?: { departments_off?: unknown } | null } | null;
  if (!org) return false;
  const licence = await loadEntitlements(admin, { id: org.id, kind: org.kind });
  return effectiveModules(licence.modules, parseDepartmentsOff(org.settings?.departments_off)).has('artistic');
}

/**
 * Is the creative approval gate IN FORCE: the owner switched it on AND the org still has the artistic department. A
 * gate left on after the department is gone (the owner switched artistic off, or the platform removed the module) must
 * gate nothing: `readMembership` takes `creative.approve` from everyone then, so nobody could ever give the approval and
 * delivery would wait for it forever, with the switch itself 404 for want of the department. The ONE rule every reader
 * of the setting uses (readiness, the deliver fingerprint, approvals, the workspace).
 */
export const creativeGateEffective = (setting: 'on' | 'off', hasArtistic: boolean): boolean => setting === 'on' && hasArtistic;

/** `creativeGateEffective` for an org, reading the department only when the setting is on (off needs no extra read). */
export async function readCreativeGate(admin: AdminClient, orgId: string): Promise<boolean> {
  const res = await admin.from('organizations').select('settings').eq('id', orgId).maybeSingle();
  if (res.error) throw new Error(`org settings read: ${res.error.message}`);
  const setting = parseReadinessSettings((res.data as { settings?: unknown } | null)?.settings).creative_gate;
  if (setting !== 'on') return false;
  return creativeGateEffective(setting, await orgHasArtistic(admin, orgId));
}

/** The message a write gives while migration 194 is missing. */
export const NEEDS_194 = 'Creative approval needs migration 194, which has not been applied yet.';
