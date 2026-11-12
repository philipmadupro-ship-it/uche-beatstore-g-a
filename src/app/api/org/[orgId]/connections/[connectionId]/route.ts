/**
 * PATCH / DELETE /api/org/[orgId]/connections/[connectionId] (LABEL-41).
 *
 *  PATCH   ARTIST SIDE ONLY — what the artist org shares with this label:
 *          `{ share_mode?, project_ids?, allow_copies? }`. `project_ids`
 *          replaces the selected list and must all be projects of the artist
 *          org; `share_mode: 'all'` shares the whole catalogue; `allow_copies`
 *          lets the label copy a recording into its own org (D6). The label
 *          side is a 404 here, whatever it holds: the artist controls what is
 *          shared. Recorded as `share.created` / `share.revoked` in the
 *          artist org, by the database function, in one transaction.
 *  DELETE  ends the connection — either side, `org.manage` (whole org). A
 *          pending request is withdrawn (its starter) or declined (the other
 *          side). The very next request of the label for the artist org's
 *          music is a 404. `connection.ended` is recorded in both orgs.
 *
 * Both need `org.manage` and a whole-org view (a scoped admin does not run
 * connections). A connection the org is not a party of is 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { OrgConnectionShareBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { CONNECTIONS_NOT_READY, auditRpc, isMissingAuditRpc, isMissingConnections } from '@/lib/labelos/audit-rpc';
import { mayChangeShare, toConnectionView } from '@/lib/labelos/connections';
import { orgIdentities, readPartyConnection, selectedProjectIds } from '@/lib/labelos/connections-store';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.connections.item');

type Params = { params: Promise<{ orgId: string; connectionId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

async function viewOf(access: Extract<Awaited<ReturnType<typeof requireOrgCapability>>, { ok: true }>, connectionId: string) {
  const conn = await readPartyConnection(access.admin, access.orgId, connectionId);
  if (!conn) return null;
  const otherId = conn.label_org_id === access.orgId ? conn.artist_org_id : conn.label_org_id;
  const [identities, selected] = await Promise.all([
    orgIdentities(access.admin, [otherId]),
    selectedProjectIds(access.admin, [conn.id]),
  ]);
  const other = identities.get(otherId);
  return other ? toConnectionView(conn, access.orgId, other, selected.get(conn.id) ?? []) : null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, connectionId } = await params;
  const access = await requireOrgCapability(orgId, 'org.manage');
  if (!access.ok) return access.res;
  if (access.artistScope !== null) return json(403, { error: 'Forbidden' });
  if (!isUUID(connectionId)) return json(404, { error: 'Not found' });
  const parsed = await readBody(req, OrgConnectionShareBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    const conn = await readPartyConnection(access.admin, access.orgId, connectionId);
    // The label side (or a third org, or an ended connection) finds nothing.
    if (!conn || !mayChangeShare(conn, access.orgId)) return json(404, { error: 'Not found' });
    const patch: Record<string, unknown> = {};
    if (body.share_mode !== undefined) patch.share_mode = body.share_mode;
    if (body.allow_copies !== undefined) patch.allow_copies = body.allow_copies;
    const { data, error } = await auditRpc(access.admin, 'connectionShare', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_connection: connectionId,
      p_patch: patch,
      p_project_ids: body.project_ids ? [...new Set(body.project_ids.map((id) => id.toLowerCase()))] : null,
      p_payload: { changed: Object.keys(body).sort() },
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingConnections(error)) return json(503, { error: CONNECTIONS_NOT_READY });
      throw new Error(error.message);
    }
    if (data?.error === 'bad_project') return json(400, { error: 'Only projects of your own organization can be shared' });
    if (data?.error) return json(404, { error: 'Not found' });
    const connection = await viewOf(access, connectionId);
    return json(200, { connection });
  } catch (err) {
    log.error('connection share failed', { orgId: access.orgId, connectionId, error: errorMessage(err) });
    return json(500, { error: 'Could not update what is shared' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, connectionId } = await params;
  const access = await requireOrgCapability(orgId, 'org.manage');
  if (!access.ok) return access.res;
  if (access.artistScope !== null) return json(403, { error: 'Forbidden' });
  if (!isUUID(connectionId)) return json(404, { error: 'Not found' });

  try {
    const conn = await readPartyConnection(access.admin, access.orgId, connectionId);
    if (!conn || (conn.status !== 'requested' && conn.status !== 'active')) return json(404, { error: 'Not found' });
    const { data, error } = await auditRpc(access.admin, 'connectionEnd', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_connection: connectionId,
      p_payload: {},
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingConnections(error)) return json(503, { error: CONNECTIONS_NOT_READY });
      throw new Error(error.message);
    }
    if (data?.error) return json(404, { error: 'Not found' });
    const status = (data?.connection as { status?: string } | undefined)?.status ?? 'ended';
    return json(200, { ok: true, status });
  } catch (err) {
    log.error('connection end failed', { orgId: access.orgId, connectionId, error: errorMessage(err) });
    return json(500, { error: 'Could not end the connection' });
  }
}
