import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.nudge-stale');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Time-decay auto-followup cron.
 *
 * Schedule: daily at 14:00 UTC (see vercel.json). Vercel signs cron
 * requests with `Authorization: Bearer <CRON_SECRET>`; we reject
 * anything else so a curious passer-by can't spam your contacts.
 *
 * Algorithm:
 *   1. Pull all beat_sends still in the `sent` stage (not opened →
 *      not engaged enough to ladder past stage 1).
 *   2. For each send, compute days-since-sent.
 *   3. Fire a follow-up at the 3 / 5 / 10 day milestones, but only
 *      once per milestone — `nudge_count` on the send tracks how
 *      many we've already fired, `last_nudge_at` stamps the most
 *      recent one. 3 nudges max; after that we give up so the
 *      producer's outbox doesn't become a harassment machine.
 *   4. Each fire bumps the underlying beat_send status to
 *      `negotiating` only on the FINAL milestone — earlier nudges
 *      are gentle and don't presume engagement.
 *
 * Why milestones and not "every N days from last nudge"?
 *   - Predictable: the recipient sees at most three follow-ups in
 *     two weeks, after which the trail goes cold on its own.
 *   - Easy to debug: nudge_count tells you exactly which milestone
 *     fired for any given send.
 */

// Day-since-sent thresholds. Each row says: "if days_since_send is
// past THRESHOLD and nudge_count < INDEX+1, fire the nudge."
const MILESTONES: Array<{ days: number; tone: 'gentle' | 'direct' | 'final' }> = [
  { days: 3,  tone: 'gentle' },
  { days: 5,  tone: 'direct' },
  { days: 10, tone: 'final' },
];

const TONE_COPY: Record<'gentle' | 'direct' | 'final', { subject: string; body: (name: string) => string }> = {
  gentle: {
    subject: 'Quick follow-up',
    body: (name) =>
      `Hi ${name},\n\nJust circling back on the tracks I sent — wanted to make sure they didn't get buried. No pressure, just let me know if anything caught your ear.\n\nBest,`,
  },
  direct: {
    subject: 'Still considering?',
    body: (name) =>
      `Hi ${name},\n\nBumping this up — happy to send something in a different lane if these didn't fit the brief. What are you working on right now?\n\nBest,`,
  },
  final: {
    subject: 'Closing the loop',
    body: (name) =>
      `Hi ${name},\n\nWanted to give this one last try. If the timing isn't right that's totally fine — just want to know whether to keep you on the list for future drops.\n\nBest,`,
  },
};

export async function GET(req: NextRequest) {
  // Vercel cron auth: rejects any request that doesn't carry the
  // CRON_SECRET bearer token. Without this, anyone hitting the URL
  // could trigger a mass-email run.
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ skipped: 'Supabase not configured' });
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: 'RESEND_API_KEY not configured' });
  }

  const admin = createServiceClient();
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    // Pull `sent`-stage sends with their contact email/name. We
    // intentionally limit to status='sent' — any send the recipient
    // has already engaged with (opened / interested / placed / pass)
    // doesn't need auto-followup. The relationship table is the
    // source of truth for engagement.
    const { data: sends, error } = await admin
      .from('beat_sends')
      .select('id, contact_id, share_token, track_ids, sent_at, status, nudge_count, last_nudge_at, contact:contacts!inner(name, email)')
      .eq('status', 'sent');
    if (error) throw error;

    const now = Date.now();
    const fired: Array<{ sendId: string; tone: string; email: string }> = [];
    const failed: Array<{ sendId: string; error: string }> = [];

    for (const s of sends ?? []) {
      const contact = (s as any).contact as { name: string; email: string | null } | null;
      if (!contact?.email) continue;

      const days = (now - Date.parse(s.sent_at)) / 86_400_000;
      const nudgeCount = (s as any).nudge_count ?? 0;

      // Pick the next milestone that's both passed AND not yet fired.
      const milestone = MILESTONES[nudgeCount];
      if (!milestone) continue;             // already at final nudge
      if (days < milestone.days) continue;  // not yet ripe

      const copy = TONE_COPY[milestone.tone];
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://uche-beatstore-g.vercel.app';
      const shareUrl = `${APP_URL}/share/${s.share_token}`;

      try {
        const { error: rErr } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: contact.email,
          subject: copy.subject,
          html: `
            <div style="font-family: sans-serif; background: #0a0907; color: #E8DCC8; padding: 40px; border-radius: 20px;">
              <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 14px; color: #D4BFA0;">${copy.subject}</h1>
              <p style="font-size: 15px; line-height: 1.7; white-space: pre-wrap;">${copy.body(contact.name)}</p>
              <div style="margin-top: 40px;">
                <a href="${shareUrl}" style="background: #E8DCC8; color: #0a0907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px;">Listen again</a>
              </div>
              <p style="margin-top: 60px; font-size: 10px; color: #4a4338; text-transform: uppercase; letter-spacing: 0.5em;">Sent via U2C</p>
            </div>
          `,
        });
        if (rErr) throw rErr;

        // Bump bookkeeping. On the final milestone we also flip the
        // status to `negotiating` so the contact drops off the
        // owner's "Needs Nudge" chip — the loop is done, no more
        // automatic sends.
        const patch: Record<string, any> = {
          nudge_count: nudgeCount + 1,
          last_nudge_at: new Date().toISOString(),
        };
        if (milestone.tone === 'final') patch.status = 'negotiating';
        await admin.from('beat_sends').update(patch).eq('id', s.id);

        fired.push({ sendId: s.id, tone: milestone.tone, email: contact.email });
      } catch (err) {
        log.error('nudge send failed', { sendId: s.id, error: errorMessage(err) });
        failed.push({ sendId: s.id, error: errorMessage(err) });
      }
    }

    log.info('cron run complete', { fired: fired.length, failed: failed.length });
    return NextResponse.json({
      ok: true,
      fired_count: fired.length,
      failed_count: failed.length,
      fired,
      failed,
    });
  } catch (err) {
    log.error('cron run errored', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
