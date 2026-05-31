import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Resend } from 'resend';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { emailShell, emailButton } from '@/lib/email/templates';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';
import { getAppUrl } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.offer.respond');

/**
 * PATCH /api/store/offer/[id] — producer responds to a buyer's offer.
 *
 * Body: { action: 'accept' | 'decline' | 'counter', counter_price_usd? }
 *
 * Updates the offer status and best-effort emails the buyer so the
 * negotiation continues (replyTo = the producer's email). Ownership is
 * enforced by matching seller_user_id to the authed user (RLS also gates
 * via the owner policy in mig 068).
 */
const bodySchema = z.object({
  action: z.enum(['accept', 'decline', 'counter']),
  counter_price_usd: z.number().positive().max(1_000_000).optional(),
});

const STATUS_FOR: Record<string, string> = {
  accept: 'accepted',
  decline: 'declined',
  counter: 'countered',
};

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await requireUser();
    if (!result.ok) return result.res;
    const { userId, admin } = result;

    const { id } = await params;
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    if (parsed.data.action === 'counter' && parsed.data.counter_price_usd == null) {
      return NextResponse.json({ error: 'Counter price required' }, { status: 400 });
    }

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, persisted: false });

    // Load + ownership check.
    const { data: offer } = await admin
      .from('buyer_offers')
      .select('id, seller_user_id, track_id, track_title, buyer_email, offered_price_usd, status')
      .eq('id', id)
      .maybeSingle();
    if (!offer || (offer as any).seller_user_id !== userId) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const action = parsed.data.action;
    const trackId = (offer as any).track_id as string | null;
    const offered = Number((offer as any).offered_price_usd);
    const buyerEmail = (offer as any).buyer_email as string;
    const title = (offer as any).track_title as string;

    // Accepting an offer that's now sold-out under exclusive rights makes no
    // sense — block it (mig 075). The track row is the source of truth.
    let trackRow: { wav_url: string | null; stems_status: string | null; exclusive_sold: boolean | null } | null = null;
    if (trackId) {
      const { data: t } = await admin
        .from('tracks')
        .select('wav_url, stems_status, exclusive_sold')
        .eq('id', trackId)
        .maybeSingle();
      trackRow = (t as any) ?? null;
      if (action === 'accept' && trackRow?.exclusive_sold) {
        return NextResponse.json(
          { error: 'Exclusive rights for this track have already sold.' },
          { status: 409 },
        );
      }
    }

    const status = STATUS_FOR[action];
    const { error: updErr } = await admin.from('buyer_offers').update({ status }).eq('id', id);
    if (updErr) throw updErr;

    // On ACCEPT, mint a Stripe Checkout payment link for the agreed price so
    // the buyer can pay immediately. The existing webhook fulfils it exactly
    // like a normal store purchase (purchase_kind=track_license, exclusive) —
    // writes license_purchases, locks the exclusive, emails the download link,
    // and flags needs_stems_upload when WAV/stems aren't ready yet.
    let paymentUrl: string | null = null;
    if (action === 'accept' && trackId && isStripeConfigured()) {
      try {
        const APP_URL = getAppUrl();
        const stemsReady = (s: string | null | undefined) =>
          s === 'ready' || s === 'done' || s === 'complete';
        const stemsPending = !trackRow?.wav_url && !stemsReady(trackRow?.stems_status);

        const session = await getStripe().checkout.sessions.create({
          mode: 'payment',
          customer_email: buyerEmail,
          line_items: [{
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(offered * 100),
              product_data: { name: `${title} — Exclusive Rights` },
            },
          }],
          metadata: {
            purchase_kind: 'track_license',
            source_surface: 'store',
            content_id: trackId,
            license_id: 'exclusive-rights',
            license_type: 'exclusive',
            seller_user_id: userId,
            buyer_email: buyerEmail,
            cart_items: JSON.stringify([
              { track_id: trackId, license_id: 'exclusive-rights', license_type: 'exclusive' },
            ]),
            promo_code: '',
            offer_id: id,
            stems_pending_track_ids: stemsPending ? trackId : '',
          },
          success_url: `${APP_URL}/store/download?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${APP_URL}/store`,
        });
        paymentUrl = session.url ?? null;
      } catch (stripeErr) {
        // Don't fail the accept — the status is already flipped. Fall back to
        // the plain "reply to arrange payment" email below.
        log.warn('offer payment-link creation failed', { offerId: id, error: errorMessage(stripeErr) });
      }
    }

    // Best-effort buyer email.
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        // Producer email for replyTo.
        const { data: prof } = await admin
          .from('creator_profiles')
          .select('contact_email')
          .eq('user_id', userId)
          .maybeSingle();
        let producerEmail = (prof as any)?.contact_email as string | null;
        if (!producerEmail) {
          const { data: authUser } = await admin.auth.admin.getUserById(userId);
          producerEmail = authUser?.user?.email ?? null;
        }

        let subject: string;
        let body: string;
        if (action === 'accept') {
          subject = `Your offer on "${title}" was accepted`;
          if (paymentUrl) {
            body = `<h1 style="color:#6DC6A4;font-size:22px;margin:0 0 8px">Offer accepted — ${money(offered)}</h1>
              <p style="color:#a08a6a;font-size:13px;margin:0 0 20px">The producer accepted your offer on <strong style="color:#E8DCC8">${title}</strong>. Pay securely below to unlock your exclusive download — the link is good for this agreed price.</p>
              ${emailButton(`Pay ${money(offered)} & download`, paymentUrl)}
              <p style="color:#6a5d4a;font-size:11px;margin:16px 0 0">Or reply to this email with any questions before paying.</p>`;
          } else {
            body = `<h1 style="color:#6DC6A4;font-size:22px;margin:0 0 8px">Offer accepted — ${money(offered)}</h1>
              <p style="color:#a08a6a;font-size:13px;margin:0 0 16px">The producer accepted your offer on <strong style="color:#E8DCC8">${title}</strong>. Reply to this email to arrange payment + delivery.</p>`;
          }
        } else if (action === 'counter') {
          const counter = parsed.data.counter_price_usd!;
          subject = `Counter-offer on "${title}" — ${money(counter)}`;
          body = `<h1 style="color:#D4BFA0;font-size:22px;margin:0 0 8px">Counter-offer: ${money(counter)}</h1>
            <p style="color:#a08a6a;font-size:13px;margin:0 0 16px">You offered ${money(offered)} for <strong style="color:#E8DCC8">${title}</strong>. The producer countered at <strong style="color:#E8DCC8">${money(counter)}</strong>. Reply to accept or keep negotiating.</p>`;
        } else {
          subject = `Update on your offer for "${title}"`;
          body = `<h1 style="color:#a08a6a;font-size:20px;margin:0 0 8px">Offer declined</h1>
            <p style="color:#a08a6a;font-size:13px;margin:0 0 16px">The producer passed on your ${money(offered)} offer for <strong style="color:#E8DCC8">${title}</strong> for now. Feel free to browse other beats or send a new offer.</p>`;
        }

        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: buyerEmail,
          ...(producerEmail ? { replyTo: producerEmail } : {}),
          subject,
          html: emailShell('U2C Beatstore', body),
        });
      }
    } catch (mailErr) {
      log.warn('offer-response email failed', { error: errorMessage(mailErr) });
    }

    return NextResponse.json({ ok: true, status, payment_url: paymentUrl });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
