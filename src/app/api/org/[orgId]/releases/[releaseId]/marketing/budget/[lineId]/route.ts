/**
 * PATCH | DELETE /api/org/[orgId]/releases/[releaseId]/marketing/budget/[lineId]
 * — change or remove one budget line. Same access as adding one (a business
 * reader who may write the plan). The event lists changed FIELD NAMES only.
 */
import { NextRequest } from 'next/server';
import { MarketingBudgetPatchBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { MarketingNotReadyError, patchBudget, removeBudget, touchPlan, type PlanRow } from '@/lib/labelos/marketing-plan-store';
import { readBody } from '@/lib/validate';
import { badId, json, planWriteContext } from '../../access';
import { budgetLineOut, moneyProblem } from '@/lib/labelos/marketing-budget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing.budget');
type Params = { params: Promise<{ orgId: string; releaseId: string; lineId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId, lineId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await planWriteContext(access, { create: false, budget: true });
  if (!made.ok) return made.res;
  if (badId(lineId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  const parsed = await readBody(req, MarketingBudgetPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  // Amount and currency are one value: changing either alone is judged against the row, so ask for both together.
  if ((parsed.data.amount_minor === undefined) !== (parsed.data.currency === undefined)) return json(400, { error: 'Change the amount and the currency together.' });
  if (parsed.data.amount_minor !== undefined && parsed.data.currency !== undefined) {
    const bad = moneyProblem(parsed.data.amount_minor, parsed.data.currency);
    if (bad) return json(400, { error: bad });
  }
  try {
    const plan = (await ctx.ensure()) as PlanRow;
    const out = await patchBudget(ctx.admin, ctx.orgId, plan.id, lineId.toLowerCase(), parsed.data);
    if (!out) return json(404, { error: 'Not found' });
    await touchPlan(ctx.admin, ctx.orgId, plan.id);
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.budget_changed', ctx.subject, { op: 'updated', lineId: out.row.id, fields: out.fields });
    return json(200, { line: budgetLineOut(out.row) });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('budget line update failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not change the budget line' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId, lineId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await planWriteContext(access, { create: false, budget: true });
  if (!made.ok) return made.res;
  if (badId(lineId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  try {
    const plan = (await ctx.ensure()) as PlanRow;
    if (!(await removeBudget(ctx.admin, ctx.orgId, plan.id, lineId.toLowerCase()))) return json(404, { error: 'Not found' });
    await touchPlan(ctx.admin, ctx.orgId, plan.id);
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.budget_changed', ctx.subject, { op: 'removed', lineId: lineId.toLowerCase() });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('budget line delete failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the budget line' });
  }
}
