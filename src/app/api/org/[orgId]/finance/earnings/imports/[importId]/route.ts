/**
 * /api/org/[orgId]/finance/earnings/imports/[importId] (LABEL-62).
 *
 *   GET  one import: its header, the lines still waiting (counts), and the
 *        per-payee totals (owed, recouped, net) and what the label retains for the payees
 *        the caller may read. `finance.read`, never a roster artist. A member
 *        limited to some artists sees the totals of their artists' payees
 *        only, and a file's header is whole-org, so they get 404 for the file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { EarningsNotReadyError, importTotals, readImport, reviewLines } from '@/lib/labelos/earnings-store';
import { importView, totalView } from '@/lib/labelos/finance/earnings-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.earnings.import');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string; importId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, importId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  if (!isUUID(importId) || access.artistScope !== null) return json(404, { error: 'Import not found' });
  try {
    const imp = await readImport(access.admin, access.orgId, importId);
    if (!imp) return json(404, { error: 'Import not found' });
    const [{ totals, retainedMinor }, waiting] = await Promise.all([importTotals(access.admin, access.orgId, importId, null), reviewLines(access.admin, access.orgId, importId)]);
    return json(200, {
      schemaReady: true,
      import: importView(imp),
      waiting_lines: waiting.length,
      totals: totals.map(totalView),
      // What the label keeps: allocated lines' gross less everything owed to payees.
      retained_minor: retainedMinor === null ? null : retainedMinor.toString(),
    });
  } catch (err) {
    if (err instanceof EarningsNotReadyError) return json(200, { schemaReady: false });
    log.error('import read failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the import' });
  }
}
