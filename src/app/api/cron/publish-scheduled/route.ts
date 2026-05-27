import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { getAppUrl } from '@/lib/env';
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

    // Fan out "drop is live" emails to subscribers (mig 059). Best-
    // effort — failure to send shouldn't roll back the publish. We
    // stamp notified_at after a successful send so a cron re-run
    // doesn't double-notify.
    let notified = 0;
    if (process.env.RESEND_API_KEY) {
      try {
        const APP_URL = getAppUrl();
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { data: subs } = await admin
          .from('drop_subscribers')
          .select('id, track_id, email')
          .in('track_id', ids)
          .is('notified_at', null);
        const subscribers = (subs ?? []) as Array<{ id: string; track_id: string; email: string }>;
        const titleById = new Map<string, string>(
          dueRows.map((r: any) => [r.id as string, r.title as string]),
        );
        for (const s of subscribers) {
          try {
            const title = titleById.get(s.track_id) ?? 'Beat';
            const url = `${APP_URL}/store/${s.track_id}`;
            await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
              to: s.email,
              subject: `🔔 ${title} is live`,
              html: `
                <div style="font-family: sans-serif; background: #0a0907; color: #E8DCC8; padding: 40px; border-radius: 20px; max-width: 560px;">
                  <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #D4BFA0; margin: 0 0 20px;">It's live</h1>
                  <p style="font-size: 15px; line-height: 1.7;"><strong>${title}</strong> just dropped on the store. You asked us to ping you.</p>
                  <div style="margin-top: 28px;">
                    <a href="${url}" style="background: #D4BFA0; color: #0a0907; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">Listen now</a>
                  </div>
                  <p style="margin-top: 32px; font-size: 10px; color: #4a4338;">You're getting this because you subscribed to this drop on the store. No future emails are queued.</p>
                </div>
              `,
            });
            await admin
              .from('drop_subscribers')
              .update({ notified_at: new Date().toISOString() })
              .eq('id', s.id);
            notified++;
          } catch (sendErr) {
            log.warn('drop notification send failed', { subscriber: s.id, error: errorMessage(sendErr) });
          }
        }
      } catch (subErr) {
        log.warn('drop subscriber fan-out failed', { error: errorMessage(subErr) });
      }
    }

    return NextResponse.json({ ok: true, published: dueRows.length, ids, notified });
  } catch (err) {
    log.warn('publish-scheduled failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
