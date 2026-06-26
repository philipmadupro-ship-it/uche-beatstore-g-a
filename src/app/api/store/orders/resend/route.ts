import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isValidEmail } from '@/lib/validate';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.orders.resend');

/**
 * POST /api/store/orders/resend
 * Body: { email: string; purchase_id: string; kind: 'track_license' | 'project_bundle' }
 *
 * Re-sends the download link email to the buyer. Verifies that the
 * email matches the purchase before sending.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  let body: { email?: string; purchase_id?: string; kind?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, purchase_id, kind } = body;
  if (!isValidEmail(email) || !purchase_id || !kind) {
    return NextResponse.json({ error: 'email, purchase_id, and kind required' }, { status: 400 });
  }

  const admin = createServiceClient();
  const APP_URL = getAppUrl();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  try {
    if (kind === 'track_license') {
      const { data: purchase, error } = await admin
        .from('license_purchases')
        .select('id, buyer_email, stripe_session_id, track_ids, amount_usd, status')
        .eq('id', purchase_id)
        .eq('buyer_email', email.toLowerCase().trim())
        .eq('status', 'paid')
        .maybeSingle();

      if (error) throw error;
      if (!purchase) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
      }

      const downloadUrl = `${APP_URL}/store/download?session_id=${purchase.stripe_session_id}`;
      const fmt = (n: number | null) =>
        n != null ? `$${Number(n).toFixed(2)}` : '';

      await resend.emails.send({
        from: fromEmail,
        to: email,
        subject: 'Your download link',
        html: `
          <div style="font-family:sans-serif;background:#090907;color:#F7EBDD;padding:40px;border-radius:20px;max-width:560px">
            <h1 style="text-transform:uppercase;letter-spacing:0.3em;font-size:13px;color:#E7D7BE;margin:0 0 20px">
              Re-sent: your files
            </h1>
            <p style="font-size:15px;line-height:1.7">
              Here's your download link for your purchase${purchase.amount_usd ? ` of ${fmt(purchase.amount_usd as number)}` : ''}.
            </p>
            <div style="margin-top:36px">
              <a href="${downloadUrl}"
                 style="background:#F7EBDD;color:#090907;padding:16px 32px;text-decoration:none;border-radius:12px;font-weight:bold;text-transform:uppercase;letter-spacing:0.2em;font-size:12px;display:inline-block">
                Download your files
              </a>
            </div>
            <p style="margin-top:48px;font-size:10px;color:#837B6D;text-transform:uppercase;letter-spacing:0.5em">
              Questions? Reply to this email.
            </p>
          </div>
        `,
      });

      log.info('resent track license email', { purchaseId: purchase_id });
      return NextResponse.json({ ok: true });
    }

    if (kind === 'project_bundle') {
      const { data: link, error } = await admin
        .from('project_access_links')
        .select('id, buyer_email, token, amount_usd, project_id')
        .eq('id', purchase_id)
        .eq('buyer_email', email.toLowerCase().trim())
        .maybeSingle();

      if (error) throw error;
      if (!link) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
      }

      const accessUrl = `${APP_URL}/store/projects/access/${link.token}`;
      const fmt = (n: number | null) =>
        n != null ? `$${Number(n).toFixed(2)}` : '';

      await resend.emails.send({
        from: fromEmail,
        to: email,
        subject: 'Your project bundle access link',
        html: `
          <div style="font-family:sans-serif;background:#090907;color:#F7EBDD;padding:40px;border-radius:20px;max-width:560px">
            <h1 style="text-transform:uppercase;letter-spacing:0.3em;font-size:13px;color:#E7D7BE;margin:0 0 20px">
              Re-sent: your bundle
            </h1>
            <p style="font-size:15px;line-height:1.7">
              Here's your access link for your project bundle${link.amount_usd ? ` purchase of ${fmt(link.amount_usd as number)}` : ''}.
            </p>
            <div style="margin-top:36px">
              <a href="${accessUrl}"
                 style="background:#F7EBDD;color:#090907;padding:16px 32px;text-decoration:none;border-radius:12px;font-weight:bold;text-transform:uppercase;letter-spacing:0.2em;font-size:12px;display:inline-block">
                Access your bundle
              </a>
            </div>
            <p style="margin-top:48px;font-size:10px;color:#837B6D;text-transform:uppercase;letter-spacing:0.5em">
              Questions? Reply to this email.
            </p>
          </div>
        `,
      });

      log.info('resent project bundle email', { purchaseId: purchase_id });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  } catch (err) {
    log.error('resend failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
