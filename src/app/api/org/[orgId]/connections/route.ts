/**
 * GET / POST /api/org/[orgId]/connections (LABEL-41, D1) — the artist ↔ label
 * connection, seen from one of its two sides.
 *
 *  GET   the org's open connections (requested or active), each as the
 *        viewer's side sees it (lib/labelos/connections#toConnectionView): the
 *        other org's name and slug, the status, what is shared. An ARTIST org's
 *        managers (`org.manage`, whole org) also get their own projects, for the
 *        sharing picker. A LABEL member who is not a manager sees only the
 *        ACTIVE connections their own artist scope reaches; an ordinary
 *        artist-org member sees none (403): who the artist is connected to is
 *        the artist's business.
 *  POST  `{ slug } | { email }` (+ `contact_id`, label side) — ask the other side to
 *        connect. A label names an ARTIST org, an artist org names a LABEL;
 *        `org.manage` on the asking org. The other side accepts
 *        (…/[connectionId]/accept). The answer never says whether the named org
 *        exists, is the right kind or already has a connection: 202 for all of
 *        those, so the call cannot be used to find out who is on the platform
 *        (and it is rate-limited). `connection.requested` is an audit event,
 *        written by the database function in both orgs, one transaction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { OrgConnectionCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { CONNECTIONS_NOT_READY, auditRpc, isMissingAuditRpc, isMissingConnections } from '@/lib/labelos/audit-rpc';
import { labelScopeReaches, toConnectionView, type ConnectionView } from '@/lib/labelos/connections';
import { artistOrgProjectChoices, listOpenConnections, orgIdentities, selectedProjectIds } from '@/lib/labelos/connections-store';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.connections');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  if (access.orgKind !== 'label' && access.orgKind !== 'artist') return json(200, { connections: [] });
  const manager = access.capabilities.has('org.manage') && access.artistScope === null;
  // An ordinary artist-org member does not see who the artist is talking to.
  if (access.orgKind === 'artist' && !manager) return json(403, { error: 'Forbidden' });
  if (access.orgKind === 'label' && !manager && !access.capabilities.has('catalog.read')) return json(403, { error: 'Forbidden' });

  try {
    const open = await listOpenConnections(access.admin, access.orgId, access.orgKind);
    const visible = manager ? open : open.filter((c) => c.status === 'active' && labelScopeReaches(access.artistScope, c));
    const otherIds = visible.map((c) => (access.orgKind === 'label' ? c.artist_org_id : c.label_org_id));
    const [identities, selected] = await Promise.all([
      orgIdentities(access.admin, otherIds),
      access.orgKind === 'artist' ? selectedProjectIds(access.admin, visible.map((c) => c.id)) : Promise.resolve(new Map<string, string[]>()),
    ]);
    const connections: ConnectionView[] = [];
    for (const c of visible) {
      const other = identities.get(access.orgKind === 'label' ? c.artist_org_id : c.label_org_id);
      if (!other) continue; // the other org was deleted
      const view = toConnectionView(c, access.orgId, other, selected.get(c.id) ?? []);
      if (view) connections.push(manager ? view : { ...view, canAccept: false });
    }
    const projects = access.orgKind === 'artist' && manager ? await artistOrgProjectChoices(access.admin, access.orgId) : undefined;
    return json(200, { connections, ...(projects ? { projects } : {}) });
  } catch (err) {
    if (err instanceof Error && isMissingConnections(err as Error & { code?: string })) {
      return json(200, { connections: [], notReady: CONNECTIONS_NOT_READY });
    }
    log.error('connection list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load connections' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  if (!access.capabilities.has('org.manage') || access.artistScope !== null) return json(403, { error: 'Forbidden' });
  if (access.orgKind !== 'label' && access.orgKind !== 'artist') return json(403, { error: 'Only label and artist organizations connect' });
  const parsed = await readBody(req, OrgConnectionCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // Probing who exists is the one abuse of this route: a small, durable budget per org and per person.
  const [orgOk, userOk] = await Promise.all([
    rateLimitDurable(`org-connect:${access.orgId}`, 20, 60 * 60 * 1000),
    rateLimitDurable(`org-connect-user:${access.userId}`, 20, 60 * 60 * 1000),
  ]);
  if (!orgOk || !userOk) return json(429, { error: 'Too many requests. Try again later.' });

  try {
    const { data, error } = await auditRpc(access.admin, 'connectionRequest', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_side: access.orgKind,
      p_target_slug: body.slug ?? null,
      p_target_email: body.email ?? null,
      p_contact: body.contact_id ?? null,
      p_payload: { by: body.slug !== undefined ? 'slug' : 'email' },
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingConnections(error)) return json(503, { error: CONNECTIONS_NOT_READY });
      throw new Error(error.message);
    }
    if (data?.error === 'bad_contact') return json(400, { error: 'That person is not on your roster' });
    // not_found, pending and success all read the same.
    return json(202, { requested: true });
  } catch (err) {
    log.error('connection request failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not send the request' });
  }
}
