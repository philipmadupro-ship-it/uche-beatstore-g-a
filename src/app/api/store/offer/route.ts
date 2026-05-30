import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Resend } from 'resend';
import { createServiceClient, requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.offer');

/**
 * GET /api/store/offer — the authed producer's received offers, newest first.
 * Used by the /sales Offers tab.
 */
export async function GET() {
  try {
    const result = await requireUser();
    if (!result.ok) return result.res;
    if (!isSupabaseConfigured()) return NextResponse.json({ offers: [] });

    const { userId, admin } = result;
    const { data, error } = await admin
      .from('buyer_offers')
      .select('id, track_id, track_title, buyer_email, offered_price_usd, message, status, created_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ offers: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * POST /api/store/offer — a buyer makes an offer on an (exclusive) beat.
 *
 * Body: { track_id, buyer_email, offered_price_usd, message? }
 *
 * Flow:
 *   1. Resolve the track + seller (service-role; the track must be store-listed).
 *   2. Insert a buyer_offers row (mig 068).
 *   3. Insert a producer notification (kind 'buyer_offer', mig 064) so the
 *      dashboard bell surfaces it in real time.
 *   4. Best-effort email the producer (Resend) so they can reply/negotiate.
 *
 * Negotiation (accept/counter/decline) happens out-of-band over email for v1.
 */
const bodySchema = z.object({
  track_id: z.string().uuid(),
  buyer_email: z.string().email(),
  offered_price_usd: z.number().positive().max(1_000_000),
  message: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid offer' }, { status: 400 });
    }
    const { track_id, buyer_email, offered_price_usd, message } = parsed.data;

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: true, persisted: false });
    }

    const admin = createServiceClient();

    // Resolve track + seller. Must be store-listed to accept offers.
    const { data: track } = await admin
      .from('tracks')
      .select('id, title, user_id, store_listed')
      .eq('id', track_id)
      .maybeSingle();
    if (!track || !(track as any).store_listed) {
      return NextResponse.json({ error: 'Track not available' }, { status: 404 });
    }
    const sellerId = (track as any).user_id as string;
    const trackTitle = (track as any).title as string;

    // 1. Persist the offer.
    const { data: offer, error: offerErr } = await admin
      .from('buyer_offers')
      .insert({
        seller_user_id: sellerId,
        track_id,
        track_title: trackTitle,
        buyer_email: buyer_email.trim().toLowerCase(),
        offered_price_usd,
        message: message?.trim() || null,
      })
      .select('id')
      .single();
    if (offerErr) throw offerErr;

    const priceLabel = `$${offered_price_usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

    // 2. Producer notification (real-time bell).
    await admin.from('notifications').insert({
      user_id: sellerId,
      kind: 'buyer_offer',
      title: `New offer — ${trackTitle} (${priceLabel})`,
      body: `From ${buyer_email}${message ? ` · "${message.slice(0, 80)}"` : ''}`,
      data: { offer_id: offer.id, track_id, buyer_email, offered_price_usd },
    }).then(({ error }) => { if (error) log.warn('offer notification insert failed', { error: error.message }); });

    // 3. Best-effort email to the producer so they can reply directly.
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        // Producer email: prefer the creator_profiles contact email, else
        // the auth account email.
        const { data: prof } = await admin
          .from('creator_profiles')
          .select('contact_email')
          .eq('user_id', sellerId)
          .maybeSingle();
        let producerEmail = (prof as any)?.contact_email as string | null;
        if (!producerEmail) {
          const { data: authUser } = await admin.auth.admin.getUserById(sellerId);
          producerEmail = authUser?.user?.email ?? null;
        }
        if (producerEmail) {
          const resend = new Resend(resendKey);
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: producerEmail,
            replyTo: buyer_email,
            subject: `New offer on "${trackTitle}" — ${priceLabel}`,
            html: `
              <div style="background:#0a0907;color:#E8DCC8;padding:32px;font-family:sans-serif;border-radius:12px">
                <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a08a6a;margin:0 0 8px">New offer</p>
                <h1 style="color:#D4BFA0;font-size:22px;margin:0 0 4px">${priceLabel} for "${trackTitle}"</h1>
                <p style="color:#a08a6a;font-size:13px;margin:0 0 16px">From <strong style="color:#E8DCC8">${buyer_email}</strong></p>
                ${message ? `<blockquote style="border-left:2px solid #2d2620;padding-left:12px;margin:0 0 16px;color:#a08a6a;font-size:13px">${message}</blockquote>` : ''}
                <p style="color:#6a5d4a;font-size:12px;margin:0">Reply to this email to negotiate directly with the buyer.</p>
              </div>`,
          });
        }
      }
    } catch (mailErr) {
      log.warn('offer email failed', { error: errorMessage(mailErr) });
    }

    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
