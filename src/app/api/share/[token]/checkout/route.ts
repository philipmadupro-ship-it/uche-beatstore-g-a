import { NextRequest, NextResponse } from 'next/server';
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
 *   body: { license_type: 'lease' | 'exclusive', track_ids: string[], buyer_email: string }
 *
 * Creates a Stripe Checkout Session for the requested license against
 * the share's owner. We resolve the price from the owner's
 * creator_profiles row (locked-in at checkout time so a producer
 * mid-flight can't accidentally change the price a buyer sees).
 *
 * Returns { url } — the client redirects the browser to it.
 *
 * Webhook (`/api/stripe/webhook`) handles the post-payment flow:
 *   - inserts a `license_purchases` row
 *   - sends the buyer a receipt with the gated WAV download link
 *   - the share page polls or refreshes to flip the license card
 *     from "Buy" → "Purchased — download"
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
    const licenseType = body.license_type as 'lease' | 'exclusive';
    const trackIds = Array.isArray(body.track_ids) ? body.track_ids : [];
    const buyerEmail = typeof body.buyer_email === 'string' ? body.buyer_email.trim() : '';

    if (!['lease', 'exclusive'].includes(licenseType)) {
      return NextResponse.json({ error: 'Invalid license_type' }, { status: 400 });
    }
    if (!trackIds.length) {
      return NextResponse.json({ error: 'No tracks selected' }, { status: 400 });
    }
    if (!buyerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail)) {
      return NextResponse.json({ error: 'Valid buyer email required' }, { status: 400 });
    }

    const admin = createServiceClient();

    // Resolve the share → owner → creator profile to get the price.
    // We trust the owner's profile, not anything the client sent —
    // never let the buyer dictate the price.
    const { data: share } = await admin
      .from('project_shares')
      .select('project_id, projects(user_id, name)')
      .eq('token', token)
      .maybeSingle();

    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }
    const sellerUserId = (share as any).projects?.user_id as string | undefined;
    const projectName = (share as any).projects?.name as string | undefined;
    if (!sellerUserId) {
      return NextResponse.json({ error: 'Share has no owner' }, { status: 400 });
    }

    // Profile-level defaults — used as the fallback when a track
    // hasn't set its own override.
    const { data: profile } = await admin
      .from('creator_profiles')
      .select('license_lease_price_usd, license_exclusive_price_usd, display_name')
      .eq('user_id', sellerUserId)
      .maybeSingle();

    const profileDefault = licenseType === 'lease'
      ? profile?.license_lease_price_usd
      : profile?.license_exclusive_price_usd;

    // Pull all selected tracks WITH their per-track price columns so
    // we can build one Stripe line item per track. Per-track listing
    // (migration 021) lets a flagship beat cost more than the rest of
    // the catalog; the profile default kicks in only for tracks that
    // didn't set their own price.
    const { data: tracks } = await admin
      .from('tracks')
      .select('id, title, lease_price_usd, exclusive_price_usd')
      .in('id', trackIds);

    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No matching tracks found' }, { status: 400 });
    }

    // Resolve effective price per track. If a track has no override
    // and the profile default is also unset/zero, the producer hasn't
    // priced this track — we refuse rather than silently charging $0.
    const lineItems: any[] = [];
    const unpriced: string[] = [];
    for (const t of tracks) {
      const override = licenseType === 'lease' ? t.lease_price_usd : t.exclusive_price_usd;
      const effective = override != null && Number(override) > 0
        ? Number(override)
        : (profileDefault != null && Number(profileDefault) > 0 ? Number(profileDefault) : null);
      if (effective == null) {
        unpriced.push(t.title);
        continue;
      }
      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(effective * 100),
          product_data: {
            name: `${licenseType === 'exclusive' ? 'Exclusive' : 'Lease'} — ${t.title}`,
            // Description gets the project context so the Stripe
            // receipt has enough info to be self-explanatory.
            description: projectName ? projectName.slice(0, 220) : undefined,
          },
        },
        quantity: 1,
      });
    }

    if (unpriced.length) {
      return NextResponse.json(
        { error: `No ${licenseType} price set for: ${unpriced.join(', ')}. Set per-track prices on the library detail page or a profile default in /settings.` },
        { status: 400 },
      );
    }

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://uche-beatstore-g.vercel.app';
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: buyerEmail,
      line_items: lineItems,
      // Stash everything the webhook needs in metadata so we don't
      // have to re-resolve from the database. Stripe metadata values
      // are strings — we JSON.stringify arrays.
      metadata: {
        share_token: token,
        license_type: licenseType,
        track_ids: JSON.stringify(trackIds),
        seller_user_id: sellerUserId,
        buyer_email: buyerEmail,
      },
      success_url: `${APP_URL}/projects/share/${token}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/projects/share/${token}?purchase=cancelled`,
    });

    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (err) {
    log.error('checkout failed', { token, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
