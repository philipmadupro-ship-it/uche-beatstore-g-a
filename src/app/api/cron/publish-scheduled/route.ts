import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.publish-scheduled');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/publish-scheduled
 *
 * Wakes up every minute (Vercel cron) and flips any draft track
 * whose scheduled_publish_at has passed to store_listed=true. Once
 * flipped, the scheduled timestamp is cleared so a re-run doesn't
 * fight a producer who unlists the track again.
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 * Anything else gets 401.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, published: 0, skipped: 'supabase not configured' });
  }

  try {
    const admin = createServiceClient();
    const now = new Date().toISOString();

    // Pick draft tracks whose schedule has elapsed. Partial index from
    // migration 056 makes this O(due rows) regardless of catalogue size.
    const { data: due, error: dueErr } = await admin
      .from('tracks')
      .select('id, title, user_id')
      .eq('store_listed', false)
      .not('scheduled_publish_at', 'is', null)
      .lte('scheduled_publish_at', now);
    if (dueErr) throw dueErr;
    const dueRows = due ?? [];
    if (dueRows.length === 0) {
      return NextResponse.json({ ok: true, published: 0 });
    }

    const ids = dueRows.map((r: any) => r.id as string);
    const { error: updateErr } = await admin
      .from('tracks')
      .update({ store_listed: true, scheduled_publish_at: null })
      .in('id', ids);
    if (updateErr) throw updateErr;

    log.info('scheduled publish fired', {
      count: dueRows.length,
      tracks: dueRows.map((r: any) => ({ id: r.id, title: r.title, user_id: r.user_id })),
    });
    return NextResponse.json({ ok: true, published: dueRows.length, ids });
  } catch (err) {
    log.warn('publish-scheduled failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
