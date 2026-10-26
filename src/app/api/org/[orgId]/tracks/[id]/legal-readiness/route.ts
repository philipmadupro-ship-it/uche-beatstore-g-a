/**
 * GET /api/org/[orgId]/tracks/[id]/legal-readiness — how ready one song is for
 * a legal handoff (LABEL-29, 09 §3.1–3.2). Derived on every read from the
 * credits, parties, split sheets, release membership and ISRC; nothing is
 * stored.
 *
 * Authorised with requireObjectAccess on the TRACK (`catalog.read`): 404 for a
 * producer track, another org's, one outside the member's artist scope or
 * missing, then 404 again for anything that is not a song or whose row the
 * member may not read (D4), as the song view answers. External project members
 * never reach it (requireObjectAccess is org members only).
 *
 * What the caller is told: `rights.read` gets every requirement with its
 * reasons (which name parties and gaps in legal identifiers). Anyone else gets
 * the counts and the display percentage only. The percentage is display only;
 * a gate reads `ready` / `blockerCount`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { evaluateLegalReadiness, readinessView } from '@/lib/labelos/legal-readiness';
import { LegalReadinessNotReadyError, loadLegalFacts, readReadinessSong } from '@/lib/labelos/legal-readiness-store';
import { memberMayReadSongRow } from '@/lib/labelos/song-stage-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.legal-readiness');

type Params = { params: Promise<{ orgId: string; id: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Legal readiness needs Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const org = access.object.orgId;

  try {
    const song = await readReadinessSong(access.admin, org, id);
    if (!song || song.type !== 'song' || !(await memberMayReadSongRow(access.admin, org, id, access.capabilities))) {
      return json(404, { error: 'Not found' });
    }
    const facts = await loadLegalFacts(access.admin, org, song);
    const readiness = readinessView(evaluateLegalReadiness(facts), access.capabilities.has('rights.read'));
    return json(200, { schemaReady: true, readiness });
  } catch (err) {
    if (err instanceof LegalReadinessNotReadyError) return json(200, { schemaReady: false });
    log.error('legal readiness failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not work out legal readiness' });
  }
}
