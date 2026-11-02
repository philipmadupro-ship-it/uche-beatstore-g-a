/**
 * PATCH /api/org/[orgId]/releases/[releaseId]/marketing/assets/[requestId] —
 * mark a request fulfilled, cancelled or open again. Same access as asking.
 * Nobody is notified: an update is in the plan and the activity feed, not the bell.
 */
import { NextRequest } from 'next/server';
import { MarketingAssetPatchBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { MarketingNotReadyError, setAssetStatus } from '@/lib/labelos/marketing-plan-store';
import { readBody } from '@/lib/validate';
import { badId, json, planWriteContext } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing.assets');
type Params = { params: Promise<{ orgId: string; releaseId: string; requestId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId, requestId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await planWriteContext(access, { create: false });
  if (!made.ok) return made.res;
  if (badId(requestId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  const parsed = await readBody(req, MarketingAssetPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const row = await setAssetStatus(ctx.admin, ctx.orgId, ctx.plan.id, requestId.toLowerCase(), parsed.data.status);
    if (!row) return json(404, { error: 'Not found' });
    await ctx.touch();
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.asset_changed', ctx.subject, { requestId: row.id, status: row.status });
    return json(200, { request: { id: row.id, kind: row.kind, note: row.note, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at, notified: row.recipient_id !== null } });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('asset request update failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not update the request' });
  }
}
