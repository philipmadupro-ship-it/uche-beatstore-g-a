import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, insert } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { escapeHtml } from '@/lib/email/templates';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    // AUTH GATE — without this the route is an open email relay: anyone could
    // POST arbitrary HTML email from our verified domain to any recipient
    // (spam / phishing / domain-reputation destruction). Only the signed-in
    // producer may send beat emails.
    const authClient = await createServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { contactId, email, subject, message, trackIds, shareToken } = await req.json();

    if (!email || !shareToken) {
      return NextResponse.json({ error: 'Missing email or shareToken' }, { status: 400 });
    }
    // shareToken is dropped into the link path — constrain to a token charset
    // so it can't smuggle markup or a different URL into the email.
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(shareToken))) {
      return NextResponse.json({ error: 'Invalid share token' }, { status: 400 });
    }

    const shareUrl = `${getAppUrl()}/share/${shareToken}`;
    const safeMessage = escapeHtml(message) || 'I have some new music for you to check out.';
    const safeSubject = (typeof subject === 'string' && subject.trim())
      ? subject.trim().slice(0, 200)
      : 'New Music Transmission from U2C Beatstore';

    // 1. Send Email via Resend
    const { data: resendData, error: resendError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: safeSubject,
      html: `
        <div style="font-family: sans-serif; background: #0a0907; color: #E8DCC8; padding: 40px; border-radius: 20px;">
          <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 14px; color: #D4BFA0;">New Assets Available</h1>
          <p style="font-size: 16px; line-height: 1.6;">${safeMessage}</p>
          <div style="margin-top: 40px;">
            <a href="${shareUrl}" style="background: #E8DCC8; color: #0a0907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px;">Listen to Assets</a>
          </div>
          <p style="margin-top: 60px; font-size: 10px; color: #4a4338; text-transform: uppercase; letter-spacing: 0.5em;">Sent via U2C</p>
        </div>
      `,
    });

    if (resendError) throw resendError;

    // 2. Log to beat_sends
    if (isSupabaseConfigured()) {
      const supabase = authClient;
      await supabase
        .from('beat_sends')
        .insert({
          contact_id: contactId,
          track_ids: trackIds,
          share_token: shareToken,
          message,
          status: 'sent',
        });
    } else {
      insert('beat_sends', {
        contact_id: contactId,
        track_ids: trackIds,
        share_token: shareToken,
        message,
        status: 'sent',
      });
    }

    return NextResponse.json({ success: true, resendId: resendData?.id });
  } catch (error) {
    console.error('Email Send Error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
