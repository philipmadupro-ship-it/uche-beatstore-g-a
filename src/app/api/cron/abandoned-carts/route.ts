import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { getAppUrl } from '@/lib/env';

const log = createLogger('cron.abandoned-carts');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Abandoned-cart recovery cron (mig 071).
 *
 * Schedule: hourly (vercel.json). Vercel signs cron requests with
 * `Authorization: Bearer <CRON_SECRET>`; reject anything else.
 *
 * Finds carts that are unrecovered + never reminded + older than 1h (and
 * younger than 7d so we don't chase ancient ones), emails a single nudge,
 * and stamps `reminded_at` so each buyer gets at most one reminder.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, reminded: 0 });

  try {
    const admin = createServiceClient();
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: carts } = await admin
      .from('abandoned_carts')
      .select('id, buyer_email, items, total_usd, item_count')
      .eq('recovered', false)
      .is('reminded_at', null)
      .lt('created_at', oneHourAgo)
      .gt('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true })
      .limit(100);

    const rows = carts ?? [];
    if (rows.length === 0) return NextResponse.json({ ok: true, reminded: 0 });

    const resendKey = process.env.RESEND_API_KEY;
    const checkoutUrl = `${getAppUrl()}/store/checkout`;
    let reminded = 0;

    for (const cart of rows as any[]) {
      // Stamp first so a slow/failed send never re-queues this row.
      await admin.from('abandoned_carts').update({ reminded_at: new Date().toISOString() }).eq('id', cart.id);

      if (!resendKey) continue;
      try {
        const items = (cart.items ?? []) as Array<{ name: string; price_usd: number }>;
        const itemRows = items.slice(0, 6).map((i) =>
          `<tr><td style="padding:6px 0;color:#E8DCC8;font-size:13px">${i.name}</td><td style="padding:6px 0;text-align:right;color:#a08a6a;font-size:13px">$${Number(i.price_usd).toFixed(2)}</td></tr>`,
        ).join('');
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: cart.buyer_email,
          subject: 'You left beats in your cart',
          html: `<div style="background:#0a0907;color:#E8DCC8;padding:32px;font-family:sans-serif;border-radius:12px">
              <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a08a6a;margin:0 0 8px">Still interested?</p>
              <h1 style="color:#D4BFA0;font-size:22px;margin:0 0 16px">Your cart is waiting</h1>
              <table style="width:100%;border-collapse:collapse;margin:0 0 16px">${itemRows}</table>
              <p style="color:#E8DCC8;font-size:14px;font-weight:bold;margin:0 0 20px">Total: $${Number(cart.total_usd).toFixed(2)}</p>
              <a href="${checkoutUrl}" style="background:#D4BFA0;color:#0a0907;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:13px">Complete your purchase</a>
            </div>`,
        });
        reminded++;
      } catch (mailErr) {
        log.warn('cart reminder send failed', { id: cart.id, error: errorMessage(mailErr) });
      }
    }

    log.info('abandoned-cart reminders sent', { scanned: rows.length, reminded });
    return NextResponse.json({ ok: true, scanned: rows.length, reminded });
  } catch (err) {
    log.error('abandoned-cart cron failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
