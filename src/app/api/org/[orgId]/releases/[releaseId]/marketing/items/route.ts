/**
 * POST /api/org/[orgId]/releases/[releaseId]/marketing/items — add a timeline
 * milestone (pre-save, teaser, release or post) to the plan, which is made by
 * the first write. `release.write` or `release.approve.marketing`.
 * Event `marketing_plan.item_changed`: the milestone's id and phase, never its title.
 */
import { NextRequest } from 'next/server';
import { MarketingItemCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PLAN_LIMITS } from '@/lib/labelos/marketing-plan';
import { MarketingNotReadyError, addItem, touchPlan, type PlanRow } from '@/lib/labelos/marketing-plan-store';
import { readBody } from '@/lib/validate';
import { json, planWriteContext } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing.items');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await planWriteContext(access, { create: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  const parsed = await readBody(req, MarketingItemCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const plan = (await ctx.ensure()) as PlanRow;
    const row = await addItem(ctx.admin, ctx.orgId, plan.id, ctx.access.userId, parsed.data);
    if (row === 'full') return json(409, { error: `A plan holds at most ${PLAN_LIMITS.items} milestones.` });
    await touchPlan(ctx.admin, ctx.orgId, plan.id);
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.item_changed', ctx.subject, { op: 'added', itemId: row.id, phase: row.phase });
    return json(201, { item: { id: row.id, phase: row.phase, title: row.title, dueOn: row.due_on, doneAt: row.done_at } });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('milestone create failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not add the milestone' });
  }
}
