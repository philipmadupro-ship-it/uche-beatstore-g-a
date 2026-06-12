import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { emailShell, emailButton, emailHeading } from '@/lib/email/templates';

const log = createLogger('stems.auto-deliver');

/**
 * Auto-deliver stems to every buyer waiting on them for a track.
 *
 * Called whenever a track's stems_status flips to 'done' (the producer
 * finished uploading stems). For each paid exclusive purchase that includes
 * this track and is still flagged needs_stems_upload, we email the buyer the
 * same /store/download link they already have (it surfaces the stem rows) and
 * clear the awaiting flag.
 *
 * Idempotency: stems_delivery_email_sent (mig 069) guards against re-sending.
 * Manual stem uploads flip stems_status='done' on EVERY individual stem, so
 * without this flag a buyer would get one email per stem — the flag ensures
 * exactly one delivery email per purchase. The download page always shows the
 * latest stems, so later uploads still reach the buyer silently.
 *
 * Best-effort and self-contained: any failure is logged, never thrown, so it
 * can be fire-and-forgotten from the upload handler without affecting the
 * upload response.
 */
export async function autoDeliverStems(
  admin: SupabaseClient,
  trackId: string,
): Promise<{ delivered: number }> {
  try {
    const { data: purchases, error } = await admin
      .from('license_purchases')
      .select('id, buyer_email, stripe_session_id, needs_stems_upload, stems_delivery_email_sent, status')
      .contains('track_ids', [trackId])
      .eq('needs_stems_upload', true)
      .eq('stems_delivery_email_sent', false);

    if (error) {
      log.warn('auto-deliver query failed', { trackId, error: errorMessage(error) });
      return { delivered: 0 };
    }

    const pending = (purchases ?? []).filter(
      (p: any) => p.status === 'paid' || p.status == null,
    );
    if (pending.length === 0) return { delivered: 0 };

    const resendKey = process.env.RESEND_API_KEY;
    const resend = resendKey ? new Resend(resendKey) : null;
    const appUrl = getAppUrl();

    let delivered = 0;
    for (const p of pending as any[]) {
      // Mark delivered FIRST (claim the row) so a concurrent flip of
      // stems_status can't double-send. The update is conditional on the flag
      // still being false; if another invocation already claimed it, rowCount
      // is 0 and we skip the email.
      const { data: claimed, error: claimErr } = await admin
        .from('license_purchases')
        .update({ needs_stems_upload: false, stems_delivery_email_sent: true })
        .eq('id', p.id)
        .eq('stems_delivery_email_sent', false)
        .select('id');
      if (claimErr || !claimed || claimed.length === 0) continue;

      if (resend) {
        const downloadUrl = p.stripe_session_id
          ? `${appUrl}/store/download?session_id=${p.stripe_session_id}`
          : `${appUrl}/store`;
        try {
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: p.buyer_email,
            subject: 'Your stems are ready to download',
            html: emailShell(
              'U2C Beatstore',
              `${emailHeading('Your stems are ready')}
               <p style="color:#D0C3AF;font-size:13px;margin:0 0 20px">The producer just uploaded the stems for your exclusive purchase. Download them any time from your delivery page.</p>
               ${emailButton('Download stems', downloadUrl)}`,
            ),
          });
        } catch (mailErr) {
          // Email failed but the flag is already set — log it so the producer
          // can re-send manually from /sales rather than silently losing it.
          log.warn('auto-deliver email failed (flag already set)', {
            purchaseId: p.id,
            error: errorMessage(mailErr),
          });
        }
      }
      delivered += 1;
    }

    if (delivered > 0) log.info('auto-delivered stems', { trackId, count: delivered });
    return { delivered };
  } catch (err) {
    log.warn('auto-deliver threw', { trackId, error: errorMessage(err) });
    return { delivered: 0 };
  }
}
