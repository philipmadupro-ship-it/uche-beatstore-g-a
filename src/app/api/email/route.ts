import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, insert } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.email');
import { buildBeatSendEmail, defaultSubject } from '@/lib/email/beat-send-template';

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

    const { contactId, email, subject, message, trackIds, shareToken, packTitle, packMeta, coverUrl, recipientName, expiresDays, allowDownloads, tracks } = await req.json();

    if (!email || !shareToken) {
      return NextResponse.json({ error: 'Missing email or shareToken' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(shareToken))) {
      return NextResponse.json({ error: 'Invalid share token' }, { status: 400 });
    }

    const shareUrl = `${getAppUrl()}/share/${shareToken}`;
    const resolvedTitle = typeof packTitle === 'string' && packTitle.trim() ? packTitle.trim() : 'New music';
    const resolvedSubject = (typeof subject === 'string' && subject.trim())
      ? subject.trim().slice(0, 200)
      : defaultSubject('U2C Beatstore', resolvedTitle);

    const html = buildBeatSendEmail({
      recipientName: typeof recipientName === 'string' && recipientName.trim() ? recipientName : email.split('@')[0],
      shareUrl,
      packTitle: resolvedTitle,
      packMeta: typeof packMeta === 'string' ? packMeta : '',
      coverUrl: typeof coverUrl === 'string' ? coverUrl : null,
      message: typeof message === 'string' ? message : '',
      allowDownloads: allowDownloads !== false,
      expiresDays: typeof expiresDays === 'number' ? expiresDays : 30,
      tracks: Array.isArray(tracks) ? tracks : [],
    });

    // 1. Send Email via Resend
    const { data: resendData, error: resendError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: resolvedSubject,
      html,
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
          // mig 089 — lets the Resend webhook correlate open/click events back here.
          email_resend_id: resendData?.id ?? null,
        });
    } else {
      insert('beat_sends', {
        contact_id: contactId,
        track_ids: trackIds,
        share_token: shareToken,
        message,
        status: 'sent',
        email_resend_id: resendData?.id ?? null,
      });
    }

    return NextResponse.json({ success: true, resendId: resendData?.id });
  } catch (error) {
    log.error('Email Send Error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
