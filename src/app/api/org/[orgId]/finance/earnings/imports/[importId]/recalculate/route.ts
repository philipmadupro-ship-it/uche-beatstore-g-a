/**
 * POST /api/org/[orgId]/finance/earnings/imports/[importId]/recalculate (LABEL-62).
 *
 * Re-runs the lines of ONE import that are waiting for review — after a split
 * sheet was circulated, a payee made, an ISRC corrected. Lines that now match
 * and allocate are allocated and recouped (after everything already
 * recouped); the rest keep waiting with their current reason. Nothing that was
 * already allocated is touched. `finance.write`, whole-organization only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { EARNINGS_NOT_READY, EarningsNotReadyError, readImport, reprocessImport, reviewLines } from '@/lib/labelos/earnings-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('api.org.finance.earnings.recalculate');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string; importId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, importId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  if (access.artistScope !== null) return json(403, { error: 'Re-running earnings needs finance access to the whole organization.' });
  if (!isUUID(importId)) return json(404, { error: 'Import not found' });
  try {
    const imp = await readImport(access.admin, access.orgId, importId);
    if (!imp) return json(404, { error: 'Import not found' });
    const waiting = await reviewLines(access.admin, access.orgId, importId);
    const outcome = await reprocessImport(access.admin, access.orgId, importId, waiting);
    if (!outcome.ok) return json(outcome.code === 'recoup_conflict' ? 409 : 422, { error: outcome.message, code: outcome.code });
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'earnings.recalculated', { type: 'earnings_import', id: importId }, {
      tried: waiting.length,
      resolved: outcome.resolved,
      waiting: outcome.stillWaiting,
    });
    return json(200, { tried: waiting.length, resolved: outcome.resolved, still_waiting: outcome.stillWaiting });
  } catch (err) {
    if (err instanceof EarningsNotReadyError) return json(503, { error: EARNINGS_NOT_READY });
    log.error('earnings recalculate failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not re-run the earnings' });
  }
}
