import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { NotificationReadBodySchema } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

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
    const [page, count] = await Promise.all([
      admin
        .from('notifications')
        .select('id, kind, title, body, data, read, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(NOTIFICATION_PAGE_SIZE),
      admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false),
    ]);

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

    let ids: string[] = [];
    if (action === 'read') {
      const parsed = NotificationReadBodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
      }
      ids = parsed.data.ids;
    }

    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId } = result;

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

    const admin = createServiceClient();
    let q = admin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    if (action === 'read') q = q.in('id', ids);

    const { error } = await q;

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
