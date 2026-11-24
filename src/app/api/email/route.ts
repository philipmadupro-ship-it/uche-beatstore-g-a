import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, insert } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { requireProducer } from '@/lib/auth/ownership';
import { createLogger } from '@/lib/log';
const log = createLogger('api.email');
import { buildBeatSendEmail } from '@/lib/email/beat-send-template';
import { beatSendEmailInput, type BeatSendRole } from '@/lib/email/beat-send-input';
import { loadProducerName, loadProjectPack, loadTrackPack } from '@/lib/email/beat-send-context';
import { resolveEmailShare } from '@/lib/share/email-share';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * GET /api/email — what the SendBeatModal preview needs to show the From and
 * the producer name exactly as a real send will use them.
 */
export async function GET() {
  const producer = await requireProducer();
  if (!producer.ok) return producer.res;
  const producerName = isSupabaseConfigured() ? await loadProducerName(producer.admin, producer.userId) : null;
  const probe = beatSendEmailInput({
    kind: 'tracks', shareUrl: '', recipientName: '', packTitle: '', trackCount: null,
    allowDownloads: true, expiresAt: null, producerName, fromAddress: process.env.RESEND_FROM_EMAIL,
  });
  return NextResponse.json({ from: probe.from, producerName: probe.producerName });
}

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

    const { contactId, email, subject, message, trackIds, shareToken, packTitle: reqPackTitle, coverUrl, recipientName, expiresDays, allowDownloads, tracks, campaignId } = await req.json();

    if (!email || !shareToken) {
      return NextResponse.json({ error: 'Missing email or shareToken' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(shareToken))) {
      return NextResponse.json({ error: 'Invalid share token' }, { status: 400 });
    }

    // Which page the link opens and what its permissions row says both come
    // from the link's own row (lib/share/email-share.ts), never the request.
    // The follow-up nudge re-sends an existing token with neither: it used to
    // print "Link expires in 30 days" for every link, and a /share/ URL even
    // for project shares, which that page cannot open.
    let sharePath = `/share/${shareToken}`;
    let emailKind: 'tracks' | 'project' = 'tracks';
    let expiresAt: string | null = null;
    let linkAllowsDownloads = allowDownloads !== false;
    let fullPlayback: boolean | null = null;
    let role: BeatSendRole | null = null;
    let projectId: string | null = null;
    let producerName: string | null = null;
    if (isSupabaseConfigured()) {
      const share = await resolveEmailShare(producer.admin, producer.userId, String(shareToken));
      if (!share.ok) return NextResponse.json({ error: share.error }, { status: share.status });
      sharePath = share.path;
      emailKind = share.kind;
      expiresAt = share.expiresAt;
      linkAllowsDownloads = share.allowDownloads;
      fullPlayback = share.fullPlayback;
      role = share.role;
      projectId = share.projectId;
      producerName = await loadProducerName(producer.admin, producer.userId);
    } else if (typeof expiresDays === 'number' && expiresDays > 0) {
      // Local-store dev mode has no share row to read.
      expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
    }

    const shareUrl = `${getAppUrl()}${sharePath}`;

    // The modal sends the pack it previewed. A re-send that carries only ids
    // (the follow-up nudge) has the pack read back from the caller's own rows.
    let packTitle: string = typeof reqPackTitle === 'string' ? reqPackTitle.trim() : '';
    let packCover: string | null = typeof coverUrl === 'string' ? coverUrl : null;
    let packTracks: Array<{ title: string; bpm?: number | null; key?: string | null; type?: string | null }> | null =
      Array.isArray(tracks) ? tracks : null;
    let trackCount: number | null = packTracks ? packTracks.length : null;
    if (isSupabaseConfigured()) {
      if (emailKind === 'project' && projectId) {
        const pack = await loadProjectPack(producer.admin, producer.userId, projectId);
        packTitle = packTitle || pack.name || '';
        packCover = packCover ?? pack.coverUrl;
        trackCount = trackCount ?? pack.trackCount;
      } else if (!packTracks) {
        const pack = await loadTrackPack(producer.admin, producer.userId, trackIds);
        packTracks = pack.tracks;
        packCover = packCover ?? pack.coverUrl;
        trackCount = pack.tracks.length;
        if (!packTitle && pack.tracks.length) {
          packTitle = pack.tracks.length === 1 ? pack.tracks[0].title : `${pack.tracks.length} tracks`;
        }
      }
    }

    const input = beatSendEmailInput({
      kind: emailKind,
      shareUrl,
      recipientName: typeof recipientName === 'string' && recipientName.trim() ? recipientName : email.split('@')[0],
      packTitle,
      trackCount,
      coverUrl: packCover,
      message: typeof message === 'string' ? message : '',
      allowDownloads: linkAllowsDownloads,
      expiresAt,
      fullPlayback,
      role,
      tracks: packTracks ?? [],
      producerName,
      subject: typeof subject === 'string' ? subject : null,
      fromAddress: process.env.RESEND_FROM_EMAIL,
    });
    const html = buildBeatSendEmail(input.template);

    // 1. Send Email via Resend
    const { data: resendData, error: resendError } = await resend.emails.send({
      from: input.from,
      to: email,
      subject: input.subject,
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
