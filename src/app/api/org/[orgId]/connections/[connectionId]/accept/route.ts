/**
 * POST /api/org/[orgId]/connections/[connectionId]/accept (LABEL-41) — accept
 * a connection request. `org.manage` (owner or admin, whole org) on the side
 * that did NOT ask: the starter cannot approve its own request, and a third
 * org finds nothing (404). Accepting makes the connection active; the label's
 * roster contact for the artist is the one the label named, or a new one named
 * after the artist org, and points at it (`contacts.artist_org_id`). Nothing is
 * shared until the ARTIST side chooses (share mode `selected`, no projects).
 * `connection.accepted` is recorded in both orgs by the database function, in
 * one transaction with the change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { CONNECTIONS_NOT_READY, auditRpc, isMissingAuditRpc, isMissingConnections } from '@/lib/labelos/audit-rpc';
import { mayAccept } from '@/lib/labelos/connections';
import { readPartyConnection } from '@/lib/labelos/connections-store';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.connections.accept');

type Params = { params: Promise<{ orgId: string; connectionId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, connectionId } = await params;
  const access = await requireOrgCapability(orgId, 'org.manage');
  if (!access.ok) return access.res;
  if (access.artistScope !== null) return json(403, { error: 'Forbidden' });
  if (!isUUID(connectionId)) return json(404, { error: 'Not found' });

  try {
    const conn = await readPartyConnection(access.admin, access.orgId, connectionId);
    if (!conn || !mayAccept(conn, access.orgId)) return json(404, { error: 'Not found' });
    const { data, error } = await auditRpc(access.admin, 'connectionAccept', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_connection: connectionId,
      p_payload: {},
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingConnections(error)) return json(503, { error: CONNECTIONS_NOT_READY });
      throw new Error(error.message);
    }
    if (data?.error === 'contact_taken') return json(409, { error: 'That roster contact already stands for another artist organization' });
    if (data?.error) return json(404, { error: 'Not found' });
    return json(200, { ok: true });
  } catch (err) {
    log.error('connection accept failed', { orgId: access.orgId, connectionId, error: errorMessage(err) });
    return json(500, { error: 'Could not accept the request' });
  }
}
