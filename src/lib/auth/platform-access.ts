/**
 * The platform console's gate (LABEL-47): is the caller a platform operator?
 *
 * An operator is a row of `platform_admins` (migration 170), which the owner
 * adds by hand in the SQL editor; no route, function or API role writes it.
 * Read LIVE on every request with the service role, never cached: deleting
 * the row shuts the console on the next request.
 *
 * Everyone else — signed out, a buyer, the producer who is not an operator,
 * every org member including org OWNERS, an external project member — gets
 * 404, never 401/403: the console does not exist for them. Org membership
 * plays no part in the answer either way: an operator needs no org, and an
 * org role never admits to the console. Any error reads as "not an operator"
 * (fail closed), and so does migration 170 not being applied.
 */
import { NextResponse } from 'next/server';
import { createServiceClient, type AdminClient, type OwnershipFail } from '@/lib/auth/ownership';
import { sessionIdentity } from '@/lib/auth/org-access';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';

const log = createLogger('lib.auth.platform-access');

export type PlatformAccessOk = { ok: true; userId: string; email: string | null; admin: AdminClient };
export type PlatformAccessResult = PlatformAccessOk | OwnershipFail;

const NOT_FOUND = (): OwnershipFail => ({ ok: false, res: NextResponse.json({ error: 'Not found' }, { status: 404 }) });

/** Is `userId` a platform operator? False on any doubt. */
export async function isPlatformAdmin(admin: Pick<AdminClient, 'from'>, userId: string): Promise<boolean> {
  if (!isUUID(userId)) return false;
  try {
    const { data, error } = await admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
    if (error) {
      log.warn('operator read failed', { error: error.message });
      return false;
    }
    return !!data;
  } catch (err) {
    log.warn('operator read failed', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** The signed-in operator, or a 404 for everyone else. For /api/platform/*. */
export async function requirePlatformAdmin(): Promise<PlatformAccessResult> {
  const session = await sessionIdentity();
  if (!session) return NOT_FOUND();
  const admin = createServiceClient();
  if (!(await isPlatformAdmin(admin, session.userId))) return NOT_FOUND();
  return { ok: true, userId: session.userId, email: session.email, admin };
}

/** The same check for the /platform page (a server component): the operator, or null → notFound(). */
export async function platformAdminForPage(): Promise<PlatformAccessOk | null> {
  const access = await requirePlatformAdmin();
  return access.ok ? access : null;
}
