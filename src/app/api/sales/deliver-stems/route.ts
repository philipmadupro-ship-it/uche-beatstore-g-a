import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Resend } from 'resend';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { getAppUrl } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.sales.deliver-stems');

/**
 * POST /api/sales/deliver-stems  body: { purchase_id }
 *
 * Producer-triggered "stems are ready" notification. Stems upload one at a
 * time, so we don't auto-fire — the producer clicks Deliver once everything
 * is uploaded. Emails the buyer the same /store/download link they already
 * have (which now surfaces the stems rows), and clears the awaiting flag.
 * Idempotent via stems_delivery_email_sent (mig 069).
 */
const bodySchema = z.object({ purchase_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    const { userId, admin } = auth;

    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, persisted: false });

    // Load + ownership check.
    const { data: purchase } = await admin
      .from('license_purchases')
      .select('id, seller_user_id, buyer_email, stripe_session_id, needs_stems_upload, stems_delivery_email_sent')
      .eq('id', parsed.data.purchase_id)
      .maybeSingle();
    if (!purchase || (purchase as any).seller_user_id !== userId) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }
    if ((purchase as any).stems_delivery_email_sent) {
      return NextResponse.json({ error: 'Stems already delivered' }, { status: 409 });
    }

    const buyerEmail = (purchase as any).buyer_email as string;
    const sessionId = (purchase as any).stripe_session_id as string | null;
    const downloadUrl = sessionId ? `${getAppUrl()}/store/download?session_id=${sessionId}` : `${getAppUrl()}/store`;

    // Email the buyer (best-effort but we report failure so the producer knows).
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: buyerEmail,
        subject: 'Your stems are ready to download',
        html: `<div style="background:#0a0907;color:#E8DCC8;padding:32px;font-family:sans-serif;border-radius:12px">
            <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a08a6a;margin:0 0 8px">U2C Beatstore</p>
            <h1 style="color:#D4BFA0;font-size:22px;margin:0 0 8px">Your stems are ready</h1>
            <p style="color:#a08a6a;font-size:13px;margin:0 0 20px">The producer has uploaded the stems for your exclusive purchase. Download them any time from your delivery page.</p>
            <a href="${downloadUrl}" style="background:#D4BFA0;color:#0a0907;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:13px">Download stems</a>
          </div>`,
      });
    }

    // Clear the awaiting flag + mark delivered (idempotency).
    const { error: updErr } = await admin
      .from('license_purchases')
      .update({ needs_stems_upload: false, stems_delivery_email_sent: true })
      .eq('id', parsed.data.purchase_id);
    if (updErr) throw updErr;

    return NextResponse.json({ ok: true, emailed: !!resendKey });
  } catch (err) {
    log.error('deliver-stems failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
