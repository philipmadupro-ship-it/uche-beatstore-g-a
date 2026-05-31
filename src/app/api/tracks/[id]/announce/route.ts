import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { getAppUrl } from '@/lib/env';
import { slugify } from '@/lib/slug';
import { emailShell, emailButton, emailHeading, emailFooter } from '@/lib/email/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.tracks.announce');

/**
 * POST /api/tracks/[id]/announce — fan out a "new drop" email to the
 * producer's followers (producer_follows, mig 066).
 *
 * Idempotent: sets tracks.drop_notified_at (mig 070) and refuses to re-send
 * unless `?force=1`. Safe to call automatically whenever a beat is listed —
 * re-listing won't re-spam. Returns { ok, notified } with the recipient count.
 *
 * Emails require a verified Resend domain to actually deliver; without
 * RESEND_API_KEY the announcement is still marked sent (count 0) so the UI
 * doesn't keep prompting.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const force = new URL(req.url).searchParams.get('force') === '1';

    const owner = await requireRowOwnership('tracks', id);
    if (!owner.ok) return owner.res;
    const { userId, admin } = owner;

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, notified: 0, persisted: false });

    const { data: track } = await admin
      .from('tracks')
      .select('id, title, cover_url, store_listed, drop_notified_at')
      .eq('id', id)
      .maybeSingle();
    if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    if (!(track as any).store_listed) {
      return NextResponse.json({ error: 'List the beat before announcing' }, { status: 400 });
    }
    if ((track as any).drop_notified_at && !force) {
      return NextResponse.json({ ok: true, notified: 0, alreadySent: true });
    }

    // Mark as announced up-front so concurrent calls (auto + manual) don't
    // double-send; the email loop below is best-effort.
    await admin.from('tracks').update({ drop_notified_at: new Date().toISOString() }).eq('id', id);

    const { data: followers } = await admin
      .from('producer_follows')
      .select('email')
      .eq('producer_user_id', userId);
    const emails = [...new Set((followers ?? []).map((f: any) => f.email).filter(Boolean))];

    let notified = 0;
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && emails.length > 0) {
      const { data: prof } = await admin
        .from('creator_profiles')
        .select('display_name')
        .eq('user_id', userId)
        .maybeSingle();
      const producerName = (prof as any)?.display_name || 'A producer you follow';
      const beatUrl = `${getAppUrl()}/store/${id}`;
      const manageUrl = `${getAppUrl()}/store/account`;
      const title = (track as any).title as string;
      const cover = (track as any).cover_url as string | null;

      const resend = new Resend(resendKey);
      const results = await Promise.allSettled(emails.map((to) =>
        resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to,
          subject: `New drop from ${producerName}: ${title}`,
          html: emailShell('New drop',
            `${emailHeading(title)}
             ${cover ? `<img src="${cover}" alt="" width="280" style="border-radius:12px;margin:0 0 16px;max-width:100%" />` : ''}
             <p style="color:#a08a6a;font-size:13px;margin:0 0 20px"><strong style="color:#E8DCC8">${producerName}</strong> just listed a new beat. Be first to grab it.</p>
             ${emailButton('Listen now', beatUrl)}
             ${emailFooter(`You follow ${producerName} on U2C.`, manageUrl)}`,
          ),
        }),
      ));
      notified = results.filter((r) => r.status === 'fulfilled').length;
    }

    log.info('drop announced', { trackId: id, followers: emails.length, notified });
    return NextResponse.json({ ok: true, notified, followers: emails.length });
  } catch (err) {
    log.error('announce failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
