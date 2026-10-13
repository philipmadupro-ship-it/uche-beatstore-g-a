/**
 * GET /api/org/[orgId]/legal/queue — the legal queue (LABEL-31, 09 §3.3): the
 * songs and releases with an open request at the `legal` gate, ready ones
 * first, then oldest first (lib/labelos/legal-queue). Any member who can read
 * approvals and holds the legal gate or `contracts.read`; they see only the
 * subjects they can open themselves (artist scope, D4) — the rest is a count.
 * Rows carry titles, an artist name, a requester name, the blocker count and
 * `ready`; never a legal name, an IPI or a note. External project members
 * never reach it (requireOrgMember answers "not a member").
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { CreditsNotReadyError } from '@/lib/labelos/credits-store';
import { canSeeLegalQueue } from '@/lib/labelos/legal-queue';
import { loadLegalQueue } from '@/lib/labelos/legal-queue-store';
import { LegalReadinessNotReadyError } from '@/lib/labelos/legal-readiness-store';
import { SplitsNotReadyError } from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.legal.queue');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'The legal queue needs Supabase.' });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  if (!canSeeLegalQueue(access.capabilities)) return json(403, { error: 'Forbidden' });
  try {
    return json(200, { ...(await loadLegalQueue(access)) });
  } catch (err) {
    if (err instanceof LegalReadinessNotReadyError || err instanceof CreditsNotReadyError || err instanceof SplitsNotReadyError) {
      return json(200, { schemaReady: false, items: [], restricted: 0, truncated: false });
    }
    log.error('legal queue failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the legal queue' });
  }
}
