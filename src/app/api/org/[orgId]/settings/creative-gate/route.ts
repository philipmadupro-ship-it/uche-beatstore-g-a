/**
 * The optional creative approval gate's switch (LABEL-68), owner only.
 *
 *  GET `{ enabled, available }` — `available` is false in an org without the artistic department (the gate would
 *      gate on an approval nobody could give), so the settings screen offers the switch only where it can work.
 *  PUT `{ enabled: boolean }` — switch it on or off. 403 for anyone whose role is not `owner` (a role, like the rest of
 *      the settings screen). The change and its `creative_gate.changed` audit event are ONE database function
 *      (migration 194): it merges the one key under the row lock and derives `from` itself. A request that changes
 *      nothing is 200 and writes nothing. Migration 194 missing: 503 naming it.
 *
 * Off by default: a missing or malformed stored value reads as off (`parseReadinessSettings`), and only the exact string
 * `on` turns the gate on. Why not PATCH …/settings: that function validates a closed key list and is being reworked
 * (LABEL-73); a new key there would mean redefining it here — the same call LABEL-65 made for the marketing plan.
 *
 * 404 for a producer org and for an org without the artistic department.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgOwner } from '@/lib/auth/org-access';
import { CreativeGateBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { NEEDS_194, orgHasArtistic } from '@/lib/labelos/creative-store';
import { readReadinessSettings } from '@/lib/labelos/release-readiness-store';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.settings.creative-gate');
type Params = { params: Promise<{ orgId: string }> };

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization settings need Supabase.' });
  const access = await requireOrgOwner(orgId, { state: 'live', freshSignIn: false });
  if (!access.ok) return access.res;
  if (access.org.kind === 'producer') return json(404, { error: 'Not found' });
  try {
    if (!(await orgHasArtistic(access.admin, access.org.id))) return json(404, { error: 'Not found' });
    const settings = await readReadinessSettings(access.admin, access.org.id);
    return json(200, { enabled: settings.creative_gate === 'on', available: true });
  } catch (err) {
    log.error('creative gate read failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the setting' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization settings need Supabase.' });
  const access = await requireOrgOwner(orgId, { state: 'live', freshSignIn: false });
  if (!access.ok) return access.res;
  if (access.org.kind === 'producer') return json(404, { error: 'Not found' });
  const parsed = await readBody(req, CreativeGateBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    if (!(await orgHasArtistic(access.admin, access.org.id))) return json(404, { error: 'Not found' });
    const { data, error } = await auditRpc(access.admin, 'creativeGate', { p_org: access.org.id, p_actor: access.userId, p_enabled: parsed.data.enabled });
    if (isMissingAuditRpc(error)) return json(503, { error: NEEDS_194 });
    if (error) throw new Error(error.message);
    if (data?.error === 'not_owner') return json(403, { error: 'Forbidden' });
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    return json(200, { enabled: data?.enabled === true, changed: data?.changed === true });
  } catch (err) {
    log.error('creative gate change failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the setting' });
  }
}
