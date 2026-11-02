/**
 * PUT /api/org/[orgId]/releases/[releaseId]/marketing/platform — tick or untick
 * one step of the fixed platform checklist (platform × step; no free text).
 * Idempotent. Same access as the timeline.
 */
import { NextRequest } from 'next/server';
import { MarketingStepBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { MarketingNotReadyError, setStep, touchPlan, type PlanRow } from '@/lib/labelos/marketing-plan-store';
import { readBody } from '@/lib/validate';
import { json, planWriteContext } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing.platform');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await planWriteContext(access, { create: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  const parsed = await readBody(req, MarketingStepBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const plan = (await ctx.ensure()) as PlanRow;
    await setStep(ctx.admin, ctx.orgId, plan.id, ctx.access.userId, parsed.data);
    await touchPlan(ctx.admin, ctx.orgId, plan.id);
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.platform_changed', ctx.subject, { platform: parsed.data.platform, step: parsed.data.step, done: parsed.data.done });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('checklist update failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not update the checklist' });
  }
}
