/**
 * GET …/finance/dashboard (LABEL-64). `finance.read` (never a roster artist).
 *
 * Reads over what LABEL-61/62/63 already stored — nothing is computed that a statement froze:
 *   positions   per payee: advanced / unrecouped / earned / recouped / on statements / owed / paid
 *   releases    per release and currency: income, royalties, marketing spent, margin
 *   summary     the folded totals LABEL-67's executive dashboard calls (`lib/labelos/finance/summary`)
 *   periods     with whether each can be closed (whole-organization readers only)
 *
 * A member limited to some artists reads only their payees' positions and their artists' releases,
 * and gets no period list and no "unattributed" income (those are the whole organization's).
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { mayCloseRole, mayReopenRole, periodOverviewView } from '@/lib/labelos/finance/period-close';
import { payeePositions, positionView } from '@/lib/labelos/finance/position';
import { releaseIncome, releaseIncomeView, unattributedView } from '@/lib/labelos/finance/release-income';
import { financeSummary, financeSummaryView } from '@/lib/labelos/finance/summary';
import { loadPeriodOverviews, loadPositionFacts, loadReleaseFacts, visibleReleaseIds } from '@/lib/labelos/finance-dashboard-store';
import { json } from '@/lib/labelos/statement-route';
import { StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.dashboard');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  try {
    const whole = access.artistScope === null;
    const [facts, rel, periods] = await Promise.all([
      loadPositionFacts(access.admin, access.orgId, access.artistScope),
      loadReleaseFacts(access.admin, access.orgId),
      whole ? loadPeriodOverviews(access.admin, access.orgId) : Promise.resolve(null),
    ]);
    const positions = payeePositions(facts);
    const income = releaseIncome({
      releases: rel.releases, items: rel.items, lines: rel.lines, royaltiesByLine: rel.royaltiesByLine, spend: rel.spend,
      visible: visibleReleaseIds(rel.releases, access.artistScope),
    });
    const summary = financeSummary({ positions, releaseRows: income.rows, periods: periods ?? undefined });
    const canClose = mayCloseRole(access.capabilities, !whole);
    const canReopen = mayReopenRole(access.role);
    return json(200, {
      schemaReady: true,
      scoped: !whole,
      positions: positions.map(positionView),
      releases: income.rows.map(releaseIncomeView),
      unattributed: whole ? income.unattributed.map(unattributedView) : [],
      summary: financeSummaryView(summary),
      periods: periods ? periods.map((p) => periodOverviewView(p, { canClose, canReopen })) : null,
    });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(200, { schemaReady: false, scoped: false, positions: [], releases: [], unattributed: [], summary: { currencies: [], periods: null }, periods: null });
    log.error('finance dashboard failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the finance dashboard' });
  }
}
