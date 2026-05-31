import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { getAppUrl } from '@/lib/env';
import { emailShell, emailButton, emailHeading, emailItemTable } from '@/lib/email/templates';

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
    const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

    // Candidates: unrecovered, not yet fully reminded (max 2), aged 1h–7d.
    const { data: carts } = await admin
      .from('abandoned_carts')
      .select('id, seller_user_id, buyer_email, items, total_usd, item_count, reminder_count, reminded_at, recovery_code')
      .eq('recovered', false)
      .lt('reminder_count', 2)
      .lt('created_at', hoursAgo(1))
      .gt('created_at', hoursAgo(24 * 7))
      .order('created_at', { ascending: true })
      .limit(100);

    const allRows = (carts ?? []) as any[];

    // Dedupe by buyer email: a buyer who retries checkout spawns several cart
    // rows — we only want ONE reminder per person. Keep the newest pending cart
    // per email; suppress the rest (bump them to reminder_count 2 so they never
    // fire). Rows are ordered oldest-first, so the last seen per email is newest.
    const newestByEmail = new Map<string, any>();
    for (const c of allRows) newestByEmail.set(c.buyer_email, c);
    const rows = [...newestByEmail.values()];
    const suppressIds = allRows.filter((c) => newestByEmail.get(c.buyer_email)?.id !== c.id).map((c) => c.id);
    if (suppressIds.length > 0) {
      await admin.from('abandoned_carts').update({ reminder_count: 2 }).in('id', suppressIds);
    }

    const resendKey = process.env.RESEND_API_KEY;
    const checkoutBase = `${getAppUrl()}/store/checkout`;
    let reminded = 0;

    for (const cart of rows) {
      // Stage gate: #1 fires after 1h (reminder_count 0); #2 after 24h
      // since the first reminder (reminder_count 1).
      const isSecond = cart.reminder_count === 1;
      if (isSecond) {
        const lastMs = cart.reminded_at ? Date.parse(cart.reminded_at) : 0;
        if (now - lastMs < 23 * 60 * 60 * 1000) continue; // not due yet
      }

      // Generate a one-time 10% recovery code on the first reminder; reuse on
      // the second. Requires a seller to scope the promo to; skip the discount
      // (still send a plain nudge) when seller is unknown.
      let code = cart.recovery_code as string | null;
      if (!code && cart.seller_user_id) {
        code = `COMEBACK${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const { error: promoErr } = await admin.from('promo_codes').insert({
          code,
          user_id: cart.seller_user_id,
          discount_percent: 10,
          max_uses: 1,
          active: true,
          expires_at: hoursAgo(-7 * 24), // +7 days
        });
        if (promoErr) { log.warn('recovery promo insert failed', { error: promoErr.message }); code = null; }
      }

      // Stamp progress first so a slow/failed send never re-queues this row.
      await admin.from('abandoned_carts')
        .update({ reminder_count: cart.reminder_count + 1, reminded_at: new Date().toISOString(), ...(code ? { recovery_code: code } : {}) })
        .eq('id', cart.id);

      if (!resendKey) continue;
      try {
        const items = (cart.items ?? []) as Array<{ name: string; price_usd: number }>;
        const itemTable = emailItemTable(items.slice(0, 6).map((i) => ({ label: i.name, value: `$${Number(i.price_usd).toFixed(2)}` })));
        const checkoutUrl = code ? `${checkoutBase}?promo=${code}` : checkoutBase;
        const discountBlock = code
          ? `<p style="color:#6DC6A4;font-size:14px;margin:0 0 18px">Here's <strong>10% off</strong> to finish — code <strong style="font-family:monospace">${code}</strong> (applied automatically at the link).</p>`
          : '';
        const headline = isSecond ? 'Last chance on your cart' : 'You left beats in your cart';

        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: cart.buyer_email,
          subject: isSecond ? `${headline} — 10% off inside` : headline,
          html: emailShell(isSecond ? 'Still want these?' : 'Still interested?',
            `${emailHeading(isSecond ? 'Your cart expires soon' : 'Your cart is waiting')}
             ${itemTable}
             <p style="color:#E8DCC8;font-size:14px;font-weight:bold;margin:0 0 16px">Total: $${Number(cart.total_usd).toFixed(2)}</p>
             ${discountBlock}
             ${emailButton('Complete your purchase', checkoutUrl)}`,
          ),
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
