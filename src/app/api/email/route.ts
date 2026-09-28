import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, insert } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { requireProducer } from '@/lib/auth/ownership';
import { createLogger } from '@/lib/log';
const log = createLogger('api.email');
import { buildBeatSendEmail, defaultSubject } from '@/lib/email/beat-send-template';
import { shareLifecycleFailure, type ShareLifecycle } from '@/lib/share/token-access';

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
    // Buyers sign in through the same Supabase auth; "signed in" is not
    // "producer". Without this any buyer account is a relay from our domain.
    const producer = await requireProducer();
    if (!producer.ok) return producer.res;

    const { contactId, email, subject, message, trackIds, shareToken, packTitle, packMeta, coverUrl, recipientName, expiresDays, allowDownloads, tracks, campaignId } = await req.json();

    if (!email || !shareToken) {
      return NextResponse.json({ error: 'Missing email or shareToken' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(shareToken))) {
      return NextResponse.json({ error: 'Invalid share token' }, { status: 400 });
    }

    // The permissions row (expiry, downloads) describes THIS link, so it is
    // read from the link's own row — never from the request. The follow-up
    // nudge re-sends an existing share without either field, and the old
    // `?? 30` fallback told every nudged recipient their link expired in 30
    // days: a never-expiring link, one with two days left, one already dead.
    let expiresAt: string | null = null;
    let linkAllowsDownloads = allowDownloads !== false;
    if (isSupabaseConfigured()) {
      // Service role only after requireProducer, with the owner filter
      // applied explicitly: a producer may only email their own links.
      const { data: share, error: shareErr } = await producer.admin
        .from('share_links')
        .select('expires_at, revoked_at, allow_downloads')
        .eq('token', String(shareToken))
        .eq('user_id', producer.userId)
        .maybeSingle();
      if (shareErr) throw shareErr;
      if (!share) {
        return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
      }
      const dead = shareLifecycleFailure(share as ShareLifecycle);
      if (dead) {
        // Emailing a link the recipient cannot open is worse than not sending.
        return NextResponse.json({ error: `${dead.error} Create a new link to send.` }, { status: 409 });
      }
      expiresAt = (share as { expires_at?: string | null }).expires_at ?? null;
      linkAllowsDownloads = (share as { allow_downloads?: boolean | null }).allow_downloads !== false;
    } else if (typeof expiresDays === 'number' && expiresDays > 0) {
      // Local-store dev mode has no share row to read.
      expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
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
      allowDownloads: linkAllowsDownloads,
      expiresAt,
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

    // Campaign attachment is optional — validate it's a uuid-ish string
    // and that the campaign belongs to the caller before stamping it.
    const resolvedCampaignId =
      typeof campaignId === 'string' && /^[0-9a-f-]{36}$/i.test(campaignId) ? campaignId : null;

    // 2. Log to beat_sends (+ campaign grouping when requested)
    if (isSupabaseConfigured()) {
      const supabase = authClient;
      let safeCampaignId: string | null = null;
      if (resolvedCampaignId) {
        // RLS scopes this select to the caller's campaigns — a foreign
        // campaign id simply resolves to null.
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('id')
          .eq('id', resolvedCampaignId)
          .maybeSingle();
        safeCampaignId = campaign?.id ?? null;
      }

      const { data: sendRow } = await supabase
        .from('beat_sends')
        .insert({
          contact_id: contactId,
          track_ids: trackIds,
          share_token: shareToken,
          message,
          status: 'sent',
          campaign_id: safeCampaignId,
          // mig 089 — lets the Resend webhook correlate open/click events back here.
          email_resend_id: resendData?.id ?? null,
        })
        .select('id')
        .maybeSingle();

      // Keep the campaign funnel in sync: one target row per
      // (campaign, contact), latest send linked.
      if (safeCampaignId && contactId) {
        await supabase
          .from('campaign_targets')
          .upsert(
            {
              campaign_id: safeCampaignId,
              contact_id: contactId,
              beat_send_id: sendRow?.id ?? null,
              status: 'sent',
            },
            { onConflict: 'campaign_id,contact_id' },
          );
      }
    } else {
      insert('beat_sends', {
        contact_id: contactId,
        track_ids: trackIds,
        share_token: shareToken,
        message,
        status: 'sent',
        campaign_id: resolvedCampaignId,
        email_resend_id: resendData?.id ?? null,
      });
    }

    return NextResponse.json({ success: true, resendId: resendData?.id });
  } catch (error) {
    log.error('Email Send Error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
