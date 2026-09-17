import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
const log = createLogger('api.store.contact');
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';
import { isValidEmail } from '@/lib/validate';
import { normalizeEmail } from '@/lib/contacts/email';

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
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (String(message).length > 2000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    // Resolve the creator's contact_email (if configured)
    let toEmail: string = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    // Also the seller the CRM lead belongs to. Single-producer app, so the one
    // creator_profiles row is the owner — but contacts.user_id must be set
    // either way: mig 097 made null-owner contact rows unreadable.
    let sellerUserId: string | null = null;
    if (isSupabaseConfigured()) {
      try {
        const admin = createServiceClient();
        const { data: profile } = await admin
          .from('creator_profiles')
          .select('contact_email, display_name, user_id')
          .not('contact_email', 'is', null)
          .limit(1)
          .maybeSingle();
        if (profile?.contact_email) toEmail = profile.contact_email;
        sellerUserId = (profile as { user_id?: string | null } | null)?.user_id ?? null;
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
        <div style="font-family: 'Inter', system-ui, sans-serif; background:#090907; color:#FFFFFF; padding:40px 32px; max-width:560px; margin:0 auto; border-radius:16px;">
          <p style="font-size:10px; text-transform:uppercase; letter-spacing:0.3em; color:#706B61; margin-bottom:24px;">
            Beat Store — Visitor Message
          </p>
          <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
            <tr>
              <td style="padding:6px 0; font-size:11px; color:#AAA294; text-transform:uppercase; letter-spacing:0.15em; width:80px;">From</td>
              <td style="padding:6px 0; font-size:13px; color:#FFFFFF;">${escHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0; font-size:11px; color:#AAA294; text-transform:uppercase; letter-spacing:0.15em;">Email</td>
              <td style="padding:6px 0; font-size:13px;"><a href="mailto:${escHtml(email)}" style="color:#FFFFFF;">${escHtml(email)}</a></td>
            </tr>
            ${subject?.trim() ? `
            <tr>
              <td style="padding:6px 0; font-size:11px; color:#AAA294; text-transform:uppercase; letter-spacing:0.15em;">Subject</td>
              <td style="padding:6px 0; font-size:13px; color:#FFFFFF;">${escHtml(subject)}</td>
            </tr>` : ''}
          </table>
          <div style="background:#0D0D0A; border:1px solid #1f1a10; border-radius:12px; padding:20px;">
            <p style="font-size:13px; line-height:1.7; color:#FFFFFF; white-space:pre-wrap; margin:0;">${escHtml(message)}</p>
          </div>
          <p style="margin-top:40px; font-size:10px; color:#5a5142; text-transform:uppercase; letter-spacing:0.4em;">
            Sent via U2C Beat Store contact form
          </p>
        </div>
      `,
    });

    if (resendError) throw resendError;

    // Upsert the enquiry into the producer's CRM. Non-fatal, but no longer
    // silent — this was inert for the same three reasons as the free-download
    // path: onConflict named a nonexistent 'email' constraint (the real index
    // is contacts_user_email_uniq (user_id, email), mig 096), no user_id was
    // set so the row was invisible under mig 097's owner-only RLS, and
    // supabase-js resolves with { error } instead of throwing so the catch
    // never fired. Store contact-form enquiries never reached the CRM.
    if (isSupabaseConfigured() && sellerUserId) {
      const admin = createServiceClient();
      const { error: contactError } = await admin.from('contacts').upsert(
        {
          user_id: sellerUserId,
          email: normalizeEmail(String(email)),
          name: String(name).trim(),
          category: 'buyer',
          buyer_pipeline_status: 'new_lead',
          // Seed the visible stage too — /api/store/me's lead upsert already
          // does this, and a contact with no crm_status falls back to the
          // derived activity tone, which reads as nothing at all for a new lead.
          crm_status: 'prospect',
        },
        // ignoreDuplicates: never overwrite the producer's curated name or
        // pipeline stage for someone who has messaged before.
        { onConflict: 'user_id,email', ignoreDuplicates: true },
      );
      if (contactError) {
        log.warn('store contact CRM upsert failed', { error: contactError.message });
      }
    } else if (isSupabaseConfigured()) {
      log.warn('store contact CRM upsert skipped — no creator profile owner');
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('Store contact error:', { error: errorMessage(err) });
    return publicError(err);
  }
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
