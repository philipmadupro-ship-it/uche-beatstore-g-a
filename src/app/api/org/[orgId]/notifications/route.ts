/**
 * /api/org/[orgId]/notifications — the bell under an org (LABEL-23, 08 §B6).
 *
 *   GET    the caller's OWN notifications of THIS org, newest first, and the
 *          true unread count (a head count, not the page — the producer bell's
 *          lesson). The recipient and the org are both in the filter: another
 *          member's rows, another org's rows and the producer's own
 *          notifications (org_id NULL, `/api/notifications`, mig 064) never
 *          appear here. Any member; a non-member and an external project
 *          member are refused by the membership gate.
 *   PATCH  ?action=read  { ids }   mark those read
 *          ?action=read_all        mark every unread one of this org read
 *          Reading is something done TO a notification, as on the producer bell.
 *          Both filter on the recipient, the org and (for ids) the id, so a
 *          guessed id of someone else's updates nothing.
 *
 * Rows are written only by `lib/labelos/notify.ts` (direct asks).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { NotificationReadBodySchema } from '@/lib/contracts';
import { readBody, isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { listOrgNotifications, markOrgNotificationsRead } from '@/lib/labelos/notification-store';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.notifications');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(200, { notifications: [], unread: 0, hasMore: false });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  try {
    return json(200, { ...(await listOrgNotifications(access.admin, { orgId: access.orgId, userId: access.userId })) });
  } catch (err) {
    log.error('notification list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load notifications' });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const action = new URL(req.url).searchParams.get('action');
  if (!isSupabaseConfigured()) return json(200, { ok: true });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  if (action !== 'read' && action !== 'read_all') return json(400, { error: 'Unknown action' });

  let ids: string[] | null = null;
  if (action === 'read') {
    const parsed = await readBody(req, NotificationReadBodySchema);
    if (!parsed.ok) return parsed.res;
    ids = parsed.data.ids.filter(isUUID);
    if (ids.length === 0) return json(200, { ok: true });
  }
  try {
    await markOrgNotificationsRead(access.admin, { orgId: access.orgId, userId: access.userId }, ids);
    return json(200, { ok: true });
  } catch (err) {
    log.error('notification read failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not update notifications' });
  }
}
