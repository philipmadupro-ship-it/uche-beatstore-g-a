/**
 * GET /api/org/[orgId]/connections/[connectionId]/projects (LABEL-41) — the
 * music a connected artist org shares with THIS label, for a member of the
 * label: the shared projects and the recordings the member may hear.
 *
 * `requireConnectionOfLabel` (lib/auth/org-access): the route's org is the
 * LABEL, the connection is active and its own, the artist org is live, the
 * member's OWN artist scope reaches the connection's roster contact and they
 * hold `catalog.read`; anything else is 404. The list is what the connection
 * shares (selected projects, or all) — nothing outside it is asked for — and
 * D4 applies with the member's own capabilities (lib/labelos/connected-music):
 * marketing sees finished recordings only. Read-only; the label never writes
 * to the artist org. Audio is `GET /api/org/[orgId]/audio/[trackId]`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireConnectionOfLabel } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadConnectedMusic } from '@/lib/labelos/connected-music';
import { orgIdentities } from '@/lib/labelos/connections-store';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.connections.projects');

type Params = { params: Promise<{ orgId: string; connectionId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, connectionId } = await params;
  const access = await requireConnectionOfLabel({ orgId, connectionId, cap: 'catalog.read' });
  if (!access.ok) return access.res;
  try {
    const [music, identities] = await Promise.all([
      loadConnectedMusic(access),
      orgIdentities(access.admin, [access.sourceOrgId]),
    ]);
    const artist = identities.get(access.sourceOrgId);
    if (!artist) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(
      { ...music, artist: { name: artist.name, slug: artist.slug } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('connected music failed', { orgId: access.orgId, connectionId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the shared music' }, { status: 500 });
  }
}
