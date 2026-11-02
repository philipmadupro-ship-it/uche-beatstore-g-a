/**
 * GET /api/org/[orgId]/releases/[releaseId]/marketing — the release's marketing
 * plan (LABEL-65): timeline, platform checklist, asset requests and, for a
 * business reader only, the budget. Tasks are LABEL-23's, read from their own
 * route (`kind=release`). Authorised like the release (`catalog.read`, artist
 * scope) in an org licensed for `marketing`; see ./access.ts.
 *
 * `plan: null` = nothing planned yet (a plan is made by the first write).
 * Migration 183 missing: `{ schemaReady: false }`. The budget key is ABSENT
 * for a caller who may not read budgets, never zeroed.
 */
import { NextRequest } from 'next/server';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { mayReadBudget, mayWriteBudget, mayWritePlan, missingPhases, planView, REQUIRED_PHASES } from '@/lib/labelos/marketing-plan';
import { MarketingNotReadyError, findPlan, loadPlanRows } from '@/lib/labelos/marketing-plan-store';
import { readReadinessSettings } from '@/lib/labelos/release-readiness-store';
import { json, planReadAccess } from './access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const read = await planReadAccess(orgId, releaseId);
  if (!read.ok) return read.res;
  const { access } = read;
  if (!read.ready) return json(200, { schemaReady: false });

  try {
    const viewer = {
      canWrite: mayWritePlan(access.capabilities),
      canWriteBudget: mayWriteBudget(access.capabilities, access.role),
      canReadBudget: mayReadBudget(access.capabilities, access.role),
    };
    const settings = await readReadinessSettings(access.admin, access.orgId);
    const required = settings.marketing_plan_required && settings.marketing_gate !== 'off';
    const plan = await findPlan(access.admin, access.orgId, access.object.id);
    if (!plan) {
      return json(200, {
        schemaReady: true,
        plan: null,
        required,
        me: { canWrite: viewer.canWrite, canWriteBudget: viewer.canWriteBudget, canSetRequired: access.role === 'owner' },
        gate: { requiredPhases: [...REQUIRED_PHASES], missing: missingPhases([]) },
      });
    }
    const rows = await loadPlanRows(access.admin, access.orgId, plan, viewer.canReadBudget);
    const view = planView(rows, viewer);
    return json(200, { schemaReady: true, required, ...view, me: { ...view.me, canSetRequired: access.role === 'owner' } });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(200, { schemaReady: false });
    log.error('marketing plan read failed', { orgId: access.orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the marketing plan' });
  }
}
