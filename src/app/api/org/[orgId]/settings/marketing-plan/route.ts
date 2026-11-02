/**
 * Whether the marketing gate asks for a plan (LABEL-65), owner only.
 *
 *  GET `{ required, schemaReady }`
 *  PUT `{ required: boolean }` — turn the requirement on or off. 403 for anyone
 *      whose role is not `owner` (a role, like the rest of the settings screen).
 *      The change and its `marketing_plan.requirement_changed` audit event are
 *      ONE database function (migration 183): it merges the one key under the
 *      row lock and derives `from` itself. A request that changes nothing is 200
 *      and writes nothing. Migration 183 missing: 503 naming it.
 *
 * Why not PATCH …/settings: that function validates a closed key list and is
 * being reworked (LABEL-73); a new key there would mean redefining it here.
 * The requirement only matters while `marketing_gate` is on; the settings
 * screen says so.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgOwner } from '@/lib/auth/org-access';
import { MarketingPlanRequiredBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { NEEDS_183, planTablesReady } from '@/lib/labelos/marketing-plan-store';
import { readReadinessSettings } from '@/lib/labelos/release-readiness-store';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.settings.marketing-plan');
type Params = { params: Promise<{ orgId: string }> };

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization settings need Supabase.' });
  const access = await requireOrgOwner(orgId, { state: 'live', freshSignIn: false });
  if (!access.ok) return access.res;
  if (access.org.kind === 'producer') return json(404, { error: 'Not found' });
  try {
    const ready = await planTablesReady(access.admin);
    const settings = await readReadinessSettings(access.admin, access.org.id);
    return json(200, { schemaReady: ready, required: ready && settings.marketing_plan_required });
  } catch (err) {
    log.error('marketing requirement read failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the setting' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Organization settings need Supabase.' });
  const access = await requireOrgOwner(orgId, { state: 'live', freshSignIn: false });
  if (!access.ok) return access.res;
  if (access.org.kind === 'producer') return json(404, { error: 'Not found' });
  const parsed = await readBody(req, MarketingPlanRequiredBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    if (!(await planTablesReady(access.admin))) return json(503, { error: NEEDS_183 });
    const { data, error } = await auditRpc(access.admin, 'marketingPlanRequired', { p_org: access.org.id, p_actor: access.userId, p_required: parsed.data.required });
    if (isMissingAuditRpc(error)) return json(503, { error: NEEDS_183 });
    if (error) throw new Error(error.message);
    if (data?.error === 'not_owner') return json(403, { error: 'Forbidden' });
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    return json(200, { required: data?.required === true, changed: data?.changed === true });
  } catch (err) {
    log.error('marketing requirement change failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the setting' });
  }
}
