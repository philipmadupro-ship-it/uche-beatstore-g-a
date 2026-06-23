import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, insert, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { errorMessage } from '@/lib/errors';

/**
 * GET /api/events — alias of /api/calendar, kept for legacy callers.
 * Both must scope to caller; pre-fix this used raw service-role unscoped
 * and exposed every user's events to anyone hitting the URL.
 */
export async function GET() {
  try {
    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const supabase = createServiceClient();
      const q = supabase
        .from('calendar_events')
        .select('*')
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .order('date', { ascending: true });
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return NextResponse.json({ events: data });
    }
    return NextResponse.json({ events: getAll('calendar_events') });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body?.title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Whitelist the columns we'll write so the caller can't impersonate by
    // passing `user_id` in the body. The cookie session is the source of truth.
    const safe = {
      title: String(body.title).trim(),
      date: body.date ?? null,
      end_date: body.end_date ?? null,
      type: body.type ?? null,
      track_ids: Array.isArray(body.track_ids) ? body.track_ids : null,
      notes: body.notes ?? null,
      color: body.color ?? null,
    };
    if (!safe.date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from('calendar_events')
        .insert({ ...safe, user_id: user.id })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ event: data });
    }

    const event = insert('calendar_events', safe);
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
