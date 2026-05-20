import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { getStripe } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('stripe.webhook');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/webhook
 *
 * Stripe → us. Verified via STRIPE_WEBHOOK_SECRET; an unsigned or
 * bad-signature request is a 400 (never trust the body without
 * verifying the signature, otherwise an attacker can call this
 * endpoint and forge purchases).
 *
 * Events we care about:
 *   - checkout.session.completed → insert license_purchases row,
 *                                  email the buyer a receipt with
 *                                  the share link.
 *   - charge.refunded            → flip download_unlocked=false on
 *                                  the row so the gated download
 *                                  endpoint denies further fetches.
 *   - charge.dispute.created     → same as refund — protect the
 *                                  seller from chargeback abuse.
 *
 * Idempotency: license_purchases.stripe_session_id is UNIQUE, so
 * duplicate webhook deliveries upsert into the same row (Stripe
 * sometimes redelivers when it doesn't get a 200 within 20s).
 */

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    log.warn('signature verification failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 });
  }

  const admin = createServiceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const meta = session.metadata ?? {};

        // cart_items is a JSON-stringified array of {track_id, license_id}
        // set by the checkout route. This is the source of truth for what
        // was purchased.
        const cartItems = (() => {
          try { return JSON.parse(meta.cart_items ?? '[]'); } catch { return []; }
        })();

        const trackIds = cartItems.map((i: any) => i.track_id);

        // Map cart license_id → DB-valid license_type.
        // DB CHECK constraint: license_type IN ('lease', 'exclusive').
        const rawLicenseId = cartItems.length > 0 ? cartItems[0].license_id : '';
        const licenseType =
          rawLicenseId === 'basic-lease' || rawLicenseId === 'lease' ? 'lease'
          : rawLicenseId === 'exclusive-rights' || rawLicenseId === 'exclusive' ? 'exclusive'
          : 'lease'; // safe fallback

        // UPSERT on stripe_session_id — handles redelivery cleanly.
        const { error } = await admin
          .from('license_purchases')
          .upsert(
            {
              seller_user_id: meta.seller_user_id || null,
              buyer_email: meta.buyer_email || session.customer_email || 'unknown@invalid',
              buyer_stripe_customer: session.customer || null,
              share_token: meta.share_token || null,
              track_ids: trackIds,
              license_type: licenseType,
              amount_usd: (session.amount_total ?? 0) / 100,
              stripe_session_id: session.id,
              stripe_payment_intent: session.payment_intent || null,
              status: 'paid',
              download_unlocked: true,
            },
            { onConflict: 'stripe_session_id' },
          );
        if (error) throw error;

        // CRM Integration: Automatically add buyer to the contacts list
        if (meta.seller_user_id && meta.buyer_email) {
          const { data: existingContact } = await admin
            .from('contacts')
            .select('id')
            .eq('user_id', meta.seller_user_id)
            .eq('email', meta.buyer_email)
            .maybeSingle();

          if (!existingContact) {
            try {
              await admin.from('contacts').insert({
                user_id: meta.seller_user_id,
                name: session.customer_details?.name || 'Customer',
                email: meta.buyer_email,
                role: 'artist',
                label: 'buyer',
                notes: 'Added automatically from Stripe Cart Checkout'
              });
            } catch (err) {
              log.warn('Failed to add contact to CRM', { error: errorMessage(err) });
            }
          }
        }

        // Receipt email — Stripe sends its own payment receipt; this
        // one is the U2C-branded "thanks for your purchase, here's
        // your access" message with the share link.
        if (process.env.RESEND_API_KEY && meta.buyer_email) {
          try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const APP_URL = getAppUrl();
            const isProjShare = meta.is_project_share !== 'false';
            const shareUrl = isProjShare
              ? `${APP_URL}/projects/share/${meta.share_token}`
              : `${APP_URL}/share/${meta.share_token}`;
            await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
              to: meta.buyer_email,
              subject: `Your licenses are ready`,
              html: `
                <div style="font-family: sans-serif; background: #0a0907; color: #E8DCC8; padding: 40px; border-radius: 20px;">
                  <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 14px; color: #D4BFA0;">Purchase complete</h1>
                  <p style="font-size: 15px; line-height: 1.7;">Thanks for your purchase. Your licenses are now active.</p>
                  <div style="margin-top: 40px;">
                    <a href="${shareUrl}" style="background: #E8DCC8; color: #0a0907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px;">Access tracks</a>
                  </div>
                  <p style="margin-top: 60px; font-size: 10px; color: #4a4338; text-transform: uppercase; letter-spacing: 0.5em;">U2C Beatstore</p>
                </div>
              `,
            });
          } catch (err) {
            log.warn('receipt email failed', { error: errorMessage(err) });
          }
        }
        break;
      }

      case 'charge.refunded':
      case 'charge.dispute.created': {
        const charge = event.data.object as any;
        // Charges link back via payment_intent; find the row and
        // revoke download access. Keep the row for audit.
        await admin
          .from('license_purchases')
          .update({
            status: event.type === 'charge.refunded' ? 'refunded' : 'disputed',
            download_unlocked: false,
          })
          .eq('stripe_payment_intent', charge.payment_intent);
        break;
      }

      default:
        // No-op for events we don't subscribe to. Return 200 so
        // Stripe doesn't retry forever.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    log.error('webhook handler errored', { type: event.type, error: errorMessage(err) });
    // Return 500 so Stripe retries. The delivery dashboard will
    // surface persistent failures.
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
