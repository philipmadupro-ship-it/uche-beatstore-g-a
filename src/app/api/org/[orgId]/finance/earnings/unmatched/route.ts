/**
 * GET /api/org/[orgId]/finance/earnings/unmatched?import=<id> (LABEL-62).
 *
 * The needs-review queue: lines that could not be matched or allocated, each
 * with its reason. `finance.read`, never a roster artist. A whole-org finance
 * reader sees every line. A member limited to some artists sees only lines whose
 * matched recording or song is in their scope: a line that matched nothing has
 * no artist, and one whose ISRC names a song outside their scope is not shown —
 * and not counted either (no "N hidden").
 */
import { NextRequest, NextResponse } from 'next/server';
import { orgProjectIdsInScope, requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { EarningsNotReadyError, reviewLines, trackIdsOfProjects, visibleReviewLines } from '@/lib/labelos/earnings-store';
import { reviewLineView } from '@/lib/labelos/finance/earnings-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.earnings.unmatched');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  const importId = req.nextUrl.searchParams.get('import');
  if (importId !== null && !isUUID(importId)) return json(400, { error: 'Invalid import id' });
  try {
    const lines = await reviewLines(access.admin, access.orgId, importId);
    let scopedTracks: Set<string> | null = null;
    if (access.artistScope !== null) {
      const projects = (await orgProjectIdsInScope(access.admin, access)) ?? [];
      scopedTracks = await trackIdsOfProjects(access.admin, projects);
    }
    const visible = visibleReviewLines(lines, access.artistScope, scopedTracks);
    return json(200, { schemaReady: true, canWrite: access.capabilities.has('finance.write') && access.artistScope === null, lines: visible.map(reviewLineView) });
  } catch (err) {
    if (err instanceof EarningsNotReadyError) return json(200, { schemaReady: false, canWrite: false, lines: [] });
    log.error('review queue failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the queue' });
  }
}
