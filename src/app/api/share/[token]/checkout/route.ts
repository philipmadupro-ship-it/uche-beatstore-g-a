import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.share.checkout');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/share/[token]/checkout
 *   body: { buyer_email: string, cart_items: { track_id: string, license_id: string }[] }
 *
 * Works for both project shares (/projects/share/[token]) and flat
 * share links (/share/[token]). Resolves the token against
 * project_shares first, then share_links as fallback.
 *
 * Prices are resolved server-side (share override → track override →
 * creator profile default). Client-supplied prices are never trusted.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const cartItems = Array.isArray(body.cart_items) ? body.cart_items : [];
    const buyerEmail = typeof body.buyer_email === 'string' ? body.buyer_email.trim() : '';

    if (!cartItems.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }
    if (!buyerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail)) {
      return NextResponse.json({ error: 'Valid buyer email required' }, { status: 400 });
    }

    const admin = createServiceClient();

    // Resolve the share token — try project_shares first, then share_links.
    let sellerUserId: string | null = null;
    let projectName: string | null = null;
    let isProjectShare = true;
    let shareLeasePrice: number | null = null;
    let shareExclusivePrice: number | null = null;
    let shareDiscountPercent: number | null = null;

    const { data: projShare } = await admin
      .from('project_shares')
      .select('project_id, lease_price_usd, exclusive_price_usd, discount_percent, projects(user_id, name)')
      .eq('token', token)
      .maybeSingle();

    if (projShare) {
      sellerUserId = (projShare as any).projects?.user_id ?? null;
      projectName = (projShare as any).projects?.name ?? null;
      shareLeasePrice = projShare.lease_price_usd != null ? Number(projShare.lease_price_usd) : null;
      shareExclusivePrice = projShare.exclusive_price_usd != null ? Number(projShare.exclusive_price_usd) : null;
      shareDiscountPercent = projShare.discount_percent != null ? Number(projShare.discount_percent) : null;
    } else {
      const { data: linkShare } = await admin
        .from('share_links')
        .select('user_id, title, lease_price_usd, exclusive_price_usd, discount_percent')
        .eq('token', token)
        .maybeSingle();

      if (linkShare) {
        sellerUserId = linkShare.user_id;
        projectName = linkShare.title;
        shareLeasePrice = linkShare.lease_price_usd != null ? Number(linkShare.lease_price_usd) : null;
        shareExclusivePrice = linkShare.exclusive_price_usd != null ? Number(linkShare.exclusive_price_usd) : null;
        shareDiscountPercent = linkShare.discount_percent != null ? Number(linkShare.discount_percent) : null;
        isProjectShare = false;
      }
    }

    if (!sellerUserId) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    // Creator profile fallback prices.
    const { data: profile } = await admin
      .from('creator_profiles')
      .select('license_lease_price_usd, license_exclusive_price_usd')
      .eq('user_id', sellerUserId)
      .maybeSingle();

    const trackIds = cartItems.map((i: any) => i.track_id);
    const { data: tracks } = await admin
      .from('tracks')
      .select('id, title, lease_price_usd, exclusive_price_usd')
      .in('id', trackIds);

    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No matching tracks found' }, { status: 400 });
    }

    const lineItems: any[] = [];
    const unpriced: string[] = [];

    for (const item of cartItems) {
      const t = tracks.find((tr) => tr.id === item.track_id);
      if (!t) continue;

      const isLease = item.license_id === 'basic-lease';
      const isExclusive = item.license_id === 'exclusive-rights';
      if (!isLease && !isExclusive) {
        unpriced.push(`${t.title} (unknown license)`);
        continue;
      }

      // Price hierarchy: share override → track override → profile default.
      const shareOverride = isLease ? shareLeasePrice : shareExclusivePrice;
      const trackOverride = isLease ? t.lease_price_usd : t.exclusive_price_usd;
      const profileDefault = isLease
        ? profile?.license_lease_price_usd
        : profile?.license_exclusive_price_usd;

      const basePrice =
        shareOverride ??
        (trackOverride != null ? Number(trackOverride) : null) ??
        (profileDefault != null ? Number(profileDefault) : null);

      if (basePrice == null || basePrice <= 0) {
        unpriced.push(t.title);
        continue;
      }

      let effective = basePrice;
      if (shareDiscountPercent != null && shareDiscountPercent > 0 && shareDiscountPercent <= 100) {
        effective = effective * (1 - shareDiscountPercent / 100);
      }

      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(effective * 100),
          product_data: {
            name: `${isExclusive ? 'Exclusive Rights' : 'Basic Lease'} — ${t.title}`,
            description: projectName ? projectName.slice(0, 220) : undefined,
          },
        },
        quantity: 1,
      });
    }

    if (unpriced.length) {
      return NextResponse.json(
        { error: `No price set for: ${unpriced.join(', ')}. Set prices in your profile or per-track.` },
        { status: 400 },
      );
    }

    if (!lineItems.length) {
      return NextResponse.json({ error: 'No valid items to charge' }, { status: 400 });
    }

    const APP_URL = getAppUrl();
    const stripe = getStripe();
    const sharePath = isProjectShare ? `/projects/share/${token}` : `/share/${token}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: buyerEmail,
      line_items: lineItems,
      metadata: {
        share_token: token,
        cart_items: JSON.stringify(cartItems),
        seller_user_id: sellerUserId,
        buyer_email: buyerEmail,
        is_project_share: String(isProjectShare),
      },
      success_url: `${APP_URL}${sharePath}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}${sharePath}?purchase=cancelled`,
    });

    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (err) {
    log.error('checkout failed', { token, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
