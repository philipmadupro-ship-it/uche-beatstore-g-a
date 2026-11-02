/**
 * POST /api/org/[orgId]/releases/[releaseId]/marketing/budget — add a budget
 * line. Budgets are business data: `release.write` or `release.approve.marketing`
 * AND `business.read.internal`, never a role-`artist` member (403 for them; the
 * read path leaves the budget out entirely). Money is whole minor units in a
 * known ISO currency (`finance/money.ts`), carried as a digit string.
 * The event is internal and names the line and its fields, NEVER an amount.
 */
import { NextRequest } from 'next/server';
import { MarketingBudgetCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PLAN_LIMITS } from '@/lib/labelos/marketing-plan';
import { MarketingNotReadyError, addBudget } from '@/lib/labelos/marketing-plan-store';
import { readBody } from '@/lib/validate';
import { json, planWriteContext } from '../access';
import { budgetLineOut, moneyProblem } from '@/lib/labelos/marketing-budget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing.budget');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await planWriteContext(access, { create: true, budget: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  const parsed = await readBody(req, MarketingBudgetCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const bad = moneyProblem(parsed.data.amount_minor, parsed.data.currency);
  if (bad) return json(400, { error: bad });
  try {
    const row = await addBudget(ctx.admin, ctx.orgId, ctx.plan.id, ctx.access.userId, parsed.data);
    if (row === 'full') return json(409, { error: `A plan holds at most ${PLAN_LIMITS.budgetLines} budget lines.` });
    await ctx.touch();
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.budget_changed', ctx.subject, { op: 'added', lineId: row.id });
    return json(201, { line: budgetLineOut(row) });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('budget line create failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not add the budget line' });
  }
}
