import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { NotificationReadBodySchema } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

/** PostgREST / Postgres: the column does not exist (migration 151 not applied yet). */
function isMissingOrgColumn(error: { message?: string; code?: string } | null): boolean {
  return !!error && (error.code === '42703' || /org_id/i.test(error.message ?? ''));
}

interface NotificationRow {
  read: boolean | null;
}

/** Rows the bell panel renders. The unread badge is NOT bounded by this. */
const NOTIFICATION_PAGE_SIZE = 20;

export async function GET() {
  try {
    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId } = result;

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ notifications: [], unread: 0 });
    }

    const admin = createServiceClient();

    // The panel shows a page of rows; the badge counts ALL of them.
    //
    // These were one query: `unread` was derived from the same 20 rows the
    // panel renders, so past 20 unread the badge undercounted — it could read
    // "9+" while the real number was far higher, and "Mark all read", which is
    // unbounded server-side, then cleared rows the producer was never shown.
    // A head count costs no rows over the wire.
    //
    // Producer notifications only (`org_id IS NULL`): a Label OS direct ask
    // (migration 151) belongs to the bell under its org, never here.
    const read = (orgScoped: boolean) => {
      const rows = admin
        .from('notifications')
        .select('id, kind, title, body, data, read, created_at')
        .eq('user_id', userId);
      const unreadCount = admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);
      return Promise.all([
        (orgScoped ? rows.is('org_id', null) : rows).order('created_at', { ascending: false }).limit(NOTIFICATION_PAGE_SIZE),
        orgScoped ? unreadCount.is('org_id', null) : unreadCount,
      ]);
    };
    let [page, count] = await read(true);
    // Before migration 151 there is no org_id column to filter on, and no org
    // notification to exclude: read exactly as before.
    if (isMissingOrgColumn(page.error) || isMissingOrgColumn(count.error)) [page, count] = await read(false);

    if (page.error) throw page.error;
    const notifications = page.data ?? [];

    // If the count query fails on its own, fall back to counting the page
    // rather than failing the whole request — a low badge beats no panel.
    const unread = count.error
      ? (notifications as NotificationRow[]).filter((n) => !n.read).length
      : count.count ?? 0;

    return NextResponse.json({
      notifications,
      unread,
      // Tells the client the list is a page, so it can say so instead of
      // implying these are all of them.
      hasMore: notifications.length === NOTIFICATION_PAGE_SIZE,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Mark notifications read.
 *
 *   ?action=read       body { ids: [...] }  — the rows the producer acted on
 *   ?action=read_all                        — an explicit "Mark all read"
 *
 * `read_all` stays, but it is now only reachable from a button the producer
 * presses. It used to fire whenever the bell panel opened, which meant looking
 * at one notification silently cleared every other one.
 *
 * Both paths filter on `user_id` as well as the ids, so a guessed id belonging
 * to another account updates zero rows rather than someone else's.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    if (action !== 'read_all' && action !== 'read') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    // Authenticate BEFORE reading the body. Validating first meant a signed-out
    // caller got a 400 about their payload instead of a 401, which reads as
    // "your request was malformed" when the real answer is "you are not signed
    // in" — and it parsed untrusted JSON for callers with no business here.
    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId } = result;

    let ids: string[] = [];
    if (action === 'read') {
      const parsed = NotificationReadBodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
      }
      ids = parsed.data.ids;
    }

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

    const admin = createServiceClient();
    const mark = (orgScoped: boolean) => {
      let q = admin
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);
      // Producer rows only: "Mark all read" here must not clear the asks waiting under an org.
      if (orgScoped) q = q.is('org_id', null);
      if (action === 'read') q = q.in('id', ids);
      return q;
    };
    let { error } = await mark(true);
    if (isMissingOrgColumn(error)) ({ error } = await mark(false));

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
