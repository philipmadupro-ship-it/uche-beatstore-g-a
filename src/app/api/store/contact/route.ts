import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

/**
 * POST /api/store/contact
 *
 * Public (no auth) — visitor-submitted contact form on the /store page.
 * Forwards the message to the creator's contact_email via Resend.
 * Falls back to RESEND_FROM_EMAIL if the creator hasn't set one.
 *
 * Rate-limiting is not implemented here; Vercel's built-in DDoS
 * protection + Resend's own limits are the safety net.
 */

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimitDurable(`contact:${clientIp(req)}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many messages — try again shortly.' }, { status: 429 });
    }
    const body = await req.json();
    const { name, email, subject, message } = body ?? {};

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'name, email, and message are required' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (String(message).length > 2000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    // Resolve the creator's contact_email (if configured)
    let toEmail: string = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    if (isSupabaseConfigured()) {
      try {
        const admin = createServiceClient();
        const { data: profile } = await admin
          .from('creator_profiles')
          .select('contact_email, display_name')
          .not('contact_email', 'is', null)
          .limit(1)
          .maybeSingle();
        if (profile?.contact_email) toEmail = profile.contact_email;
      } catch {
        // Non-fatal: fall back to env
      }
    }

    const subjectLine = subject?.trim()
      ? `[Store Contact] ${subject.trim()}`
      : `[Store Contact] Message from ${name}`;

    const { error: resendError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: toEmail,
      replyTo: email,
      subject: subjectLine,
      html: `
        <div style="font-family: 'Inter', system-ui, sans-serif; background:#0a0907; color:#E8DCC8; padding:40px 32px; max-width:560px; margin:0 auto; border-radius:16px;">
          <p style="font-size:10px; text-transform:uppercase; letter-spacing:0.3em; color:#5a5142; margin-bottom:24px;">
            Beat Store — Visitor Message
          </p>
          <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
            <tr>
              <td style="padding:6px 0; font-size:11px; color:#6a5d4a; text-transform:uppercase; letter-spacing:0.15em; width:80px;">From</td>
              <td style="padding:6px 0; font-size:13px; color:#E8DCC8;">${escHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0; font-size:11px; color:#6a5d4a; text-transform:uppercase; letter-spacing:0.15em;">Email</td>
              <td style="padding:6px 0; font-size:13px;"><a href="mailto:${escHtml(email)}" style="color:#D4BFA0;">${escHtml(email)}</a></td>
            </tr>
            ${subject?.trim() ? `
            <tr>
              <td style="padding:6px 0; font-size:11px; color:#6a5d4a; text-transform:uppercase; letter-spacing:0.15em;">Subject</td>
              <td style="padding:6px 0; font-size:13px; color:#E8DCC8;">${escHtml(subject)}</td>
            </tr>` : ''}
          </table>
          <div style="background:#14110d; border:1px solid #1f1a13; border-radius:12px; padding:20px;">
            <p style="font-size:13px; line-height:1.7; color:#E8DCC8; white-space:pre-wrap; margin:0;">${escHtml(message)}</p>
          </div>
          <p style="margin-top:40px; font-size:10px; color:#3a3328; text-transform:uppercase; letter-spacing:0.4em;">
            Sent via U2C Beat Store contact form
          </p>
        </div>
      `,
    });

    if (resendError) throw resendError;

    // Upsert buyer contact in CRM (non-fatal — DB may not have migration 038 yet)
    if (isSupabaseConfigured()) {
      try {
        const admin = createServiceClient();
        await admin
          .from('contacts')
          .upsert(
            {
              email,
              name: String(name).trim(),
              category: 'buyer',
              buyer_pipeline_status: 'new_lead',
            },
            { onConflict: 'email', ignoreDuplicates: false },
          );
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Store contact error:', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
