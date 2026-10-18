/**
 * Organization settings, owner only (LABEL-51, doc 21 §5.2 #5).
 *
 *  GET   `{ settings, licensed, switchable }` — the stored switches (total over
 *        any stored value), the departments the licence includes, and which of
 *        those the owner may switch off.
 *  PATCH `{ legal_gate?, marketing_gate?, require_signed_master_split?,
 *        attention_release_days?, attention_stalled_days?, departments_off? }`
 *        — change the named keys. 403 for anyone whose role is not `owner`
 *        (an admin holding every capability included: owner-only is a role,
 *        like LABEL-39's export and deletion). The change and its
 *        `org.settings_changed` audit event are ONE database function
 *        (migration 172), so a change with no record cannot exist. The event
 *        names the keys with their old and new values; settings hold no free
 *        text. A request that changes nothing is 200 and writes nothing.
 *
 * `legal_gate = 'off'` is an explicit, audited skip of the legal APPROVAL
 * (decision 5); `credits_splits` still gates. A department can only be
 * switched off when the licence includes it: the owner narrows, never widens.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgOwner, type OrgOwnerOk } from '@/lib/auth/org-access';
import { OrgSettingsPatchBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { ORG_SETTINGS_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { loadEntitlements } from '@/lib/labelos/entitlements-store';
import { SWITCHABLE_MODULES, parseOrgSettings, planSettingsChange } from '@/lib/labelos/org-settings';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.settings');
type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

async function load(access: OrgOwnerOk) {
  const { admin, org } = access;
  const [row, entitlements] = await Promise.all([
    admin.from('organizations').select('settings').eq('id', org.id).is('deleted_at', null).maybeSingle(),
    loadEntitlements(admin, org),
  ]);
  if (row.error) throw new Error(row.error.message);
  if (!row.data) return null;
  // The producer's own org has no face and no licence: nothing here applies to it.
  if (org.kind === 'producer') return null;
  const raw = (row.data as { settings?: unknown }).settings;
  return { raw, licensed: entitlements.modules };
}

function view(raw: unknown, licensed: ReadonlySet<string>) {
  return {
    settings: parseOrgSettings(raw),
    licensed: [...licensed],
    switchable: SWITCHABLE_MODULES.filter((m) => licensed.has(m)),
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization settings need Supabase.' });
  const access = await requireOrgOwner(orgId, { state: 'live', freshSignIn: false });
  if (!access.ok) return access.res;
  try {
    const loaded = await load(access);
    if (!loaded) return json(404, { error: 'Not found' });
    return json(200, view(loaded.raw, loaded.licensed));
  } catch (err) {
    log.error('settings read failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the organization settings' });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization settings need Supabase.' });
  const access = await requireOrgOwner(orgId, { state: 'live', freshSignIn: false });
  if (!access.ok) return access.res;

  const parsed = await readBody(req, OrgSettingsPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const loaded = await load(access);
    if (!loaded) return json(404, { error: 'Not found' });
    const plan = planSettingsChange({ current: loaded.raw, patch: parsed.data, licensed: loaded.licensed });
    if (!plan.ok) return json(422, { error: plan.error });
    if (plan.keys.length === 0) return json(200, { ...view(loaded.raw, loaded.licensed), changed: [] });

    const { data, error } = await auditRpc(access.admin, 'orgSettings', {
      p_org: access.org.id,
      p_actor: access.userId,
      p_patch: plan.patch,
      p_payload: plan.payload,
    });
    if (isMissingAuditRpc(error)) return json(503, { error: ORG_SETTINGS_NOT_READY });
    if (error) throw new Error(error.message);
    if (data?.error === 'not_owner') return json(403, { error: 'Forbidden' });
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    return json(200, { ...view(data?.settings, loaded.licensed), changed: plan.keys });
  } catch (err) {
    log.error('settings change failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the organization settings' });
  }
}
