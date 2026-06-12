import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { getAppUrl } from '@/lib/env';
import { emailShell, emailButton, emailHeading, emailFooter } from '@/lib/email/templates';

const log = createLogger('cron.announce-drops');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * New-drop digest cron (mig 070).
 *
 * Schedule: hourly (vercel.json). Instead of emailing followers once per beat
 * (spammy when a producer lists several at once), this batches: it finds all
 * store-listed beats with drop_notified_at IS NULL (the "pending announce"
 * queue), groups them by seller, sends each seller's followers ONE digest of
 * everything new, then stamps drop_notified_at so they're never re-sent.
 *
 * CRON_SECRET-gated like the other crons.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, sellers: 0 });

  try {
    const admin = createServiceClient();

    // Pending beats: listed, never announced. Cap so a huge backlog doesn't
    // blow the function time budget — the next run picks up the rest.
    const { data: pending } = await admin
      .from('tracks')
      .select('id, title, cover_url, user_id, created_at')
      .eq('store_listed', true)
      .is('drop_notified_at', null)
      .order('created_at', { ascending: false })
      .limit(200);

    const rows = (pending ?? []).filter((t: any) => t.user_id);
    if (rows.length === 0) return NextResponse.json({ ok: true, sellers: 0, beats: 0 });

    // Group by seller.
    const bySeller = new Map<string, any[]>();
    for (const t of rows) {
      const arr = bySeller.get((t as any).user_id) ?? [];
      arr.push(t);
      bySeller.set((t as any).user_id, arr);
    }

    const resendKey = process.env.RESEND_API_KEY;
    const stampNow = new Date().toISOString();
    let sellersNotified = 0;
    let emailsSent = 0;

    for (const [sellerId, beats] of bySeller) {
      const beatIds = beats.map((b) => b.id);

      // Stamp first so a slow send never re-queues these beats next run.
      await admin.from('tracks').update({ drop_notified_at: stampNow }).in('id', beatIds);

      if (!resendKey) continue;

      const { data: followers } = await admin
        .from('producer_follows')
        .select('email')
        .eq('producer_user_id', sellerId);
      const emails = [...new Set((followers ?? []).map((f: any) => f.email).filter(Boolean))];
      if (emails.length === 0) continue;

      const { data: prof } = await admin
        .from('creator_profiles')
        .select('display_name')
        .eq('user_id', sellerId)
        .maybeSingle();
      const producerName = (prof as any)?.display_name || 'A producer you follow';
      const appUrl = getAppUrl();

      const beatRows = beats.slice(0, 12).map((b) =>
        `<tr>
           <td style="padding:8px 0;width:56px">${b.cover_url ? `<img src="${b.cover_url}" width="48" height="48" style="border-radius:8px;object-fit:cover" />` : ''}</td>
           <td style="padding:8px 0;color:#F7EBDD;font-size:14px"><a href="${appUrl}/store/${b.id}" style="color:#F7EBDD;text-decoration:none">${b.title}</a></td>
         </tr>`,
      ).join('');
      const more = beats.length > 12 ? `<p style="color:#B4AA99;font-size:12px;margin:4px 0 0">+${beats.length - 12} more</p>` : '';
      const headline = beats.length === 1 ? `${producerName} dropped a new beat` : `${producerName} dropped ${beats.length} new beats`;

      const resend = new Resend(resendKey);
      const results = await Promise.allSettled(emails.map((to) =>
        resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to,
          subject: headline,
          html: emailShell(`New from ${producerName}`,
            `${emailHeading(headline)}
             <table style="width:100%;border-collapse:collapse;margin:0 0 16px">${beatRows}</table>
             ${more}
             ${emailButton('Listen now', `${appUrl}/store`)}
             ${emailFooter(`You follow ${producerName} on U2C.`, `${appUrl}/store/account`)}`,
          ),
        }),
      ));
      emailsSent += results.filter((r) => r.status === 'fulfilled').length;
      sellersNotified++;
    }

    log.info('drop digests sent', { sellers: sellersNotified, beats: rows.length, emails: emailsSent });
    return NextResponse.json({ ok: true, sellers: sellersNotified, beats: rows.length, emails: emailsSent });
  } catch (err) {
    log.error('announce-drops cron failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
