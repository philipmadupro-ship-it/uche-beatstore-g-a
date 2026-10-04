/**
 * GET /api/org/[orgId]/songs/[trackId] (LABEL-17) — one org song: its stage,
 * artists, projects, releases and the recordings the member may hear
 * (07 §2.3, 17 R1). Recordings play through `/api/org/[orgId]/audio/[id]`.
 *
 * requireObjectAccess on the TRACK (row org, artist scope through its
 * projects, `catalog.read`): 404 for a producer track, another org's, one
 * out of scope or missing. Then 404 when it is not a song with a stage (a
 * master, a beat) or a row the member may not see (D4: an in-development
 * song for marketing), as PostgREST would show nothing. A recording the
 * member may not hear is left out and counted — the page says "restricted".
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadOrgSong } from '@/lib/labelos/org-workspace-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.songs.id');

type Params = { params: Promise<{ orgId: string; trackId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, trackId } = await params;
  const access = await requireObjectAccess({ table: 'tracks', id: trackId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  try {
    const detail = await loadOrgSong(access);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('song load failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the song' }, { status: 500 });
  }
}
