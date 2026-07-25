import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

interface NotificationRow {
  read: boolean | null;
}

export async function GET() {
  try {
    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId } = result;

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ notifications: [], unread: 0 });
    }

    const admin = createServiceClient();
    const { data, error } = await admin
      .from('notifications')
      .select('id, kind, title, body, data, read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    const notifications = data ?? [];
    const unread = (notifications as NotificationRow[]).filter((n) => !n.read).length;
    return NextResponse.json({ notifications, unread });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    if (action !== 'read_all') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId } = result;

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

    const admin = createServiceClient();
    const { error } = await admin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
