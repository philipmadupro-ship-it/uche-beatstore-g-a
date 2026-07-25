import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
import { isValidEmail, isUUID } from '@/lib/validate';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

const log = createLogger('api.share.checkout');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ShareCheckoutBody {
  buyer_email?: unknown;
  cart_items?: unknown;
}

interface ShareCheckoutItem {
  track_id: string;
  license_id: string;
}

interface ProjectShareCheckoutRow {
  project_id: string;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
  discount_percent?: number | null;
  projects?: {
    user_id?: string | null;
    name?: string | null;
  } | null;
}

interface LinkShareCheckoutRow {
  user_id: string;
  title?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
  discount_percent?: number | null;
}

interface CreatorPriceProfile {
  license_lease_price_usd?: number | null;
  license_exclusive_price_usd?: number | null;
}

interface CheckoutTrackRow {
  id: string;
  title: string;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
}

interface CheckoutLicenseRow {
  id: string;
  name: string;
  price_usd?: number | null;
  is_exclusive?: boolean | null;
  is_free?: boolean | null;
}

interface TrackLicenseOverrideRow {
  track_id: string;
  license_id: string;
  price_override_usd?: number | null;
  enabled?: boolean | null;
}

interface ShareCheckoutLineItem {
  price_data: {
    currency: 'usd';
    unit_amount: number;
    product_data: {
      name: string;
      description?: string;
    };
  };
  quantity: 1;
}

function isShareCheckoutItem(item: unknown): item is ShareCheckoutItem {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  return typeof record.track_id === 'string' && typeof record.license_id === 'string';
}

/**
 * POST /api/share/[token]/checkout
 *   body: {
 *     buyer_email: string,
 *     cart_items: Array<{
 *       track_id:    string,
 *       license_id:  string,   // UUID for custom tier OR legacy 'basic-lease' / 'exclusive-rights'
 *     }>
 *   }
 *
 * Works for both project shares (/projects/share/[token]) and flat
 * share links (/share/[token]). Resolves the token against
 * project_shares first, then share_links as fallback.
 *
 * Price resolution priority (server-side — client prices never trusted):
 *   1. track_licenses.price_override_usd (custom tier, per-track override)
 *   2. licenses.price_usd (custom tier base price)
 *   3. share override (lease_price_usd / exclusive_price_usd on the share)
 *   4. track.lease_price_usd / exclusive_price_usd (per-track legacy)
 *   5. creator_profile default prices
 *
 * Discount percent (if set on the share) is applied on top of the resolved base.
 *
 * Metadata written to Stripe Session for the webhook to consume:
 *   purchase_kind    — 'track_license'
 *   source_surface   — 'share_link'
 *   share_token      — the token
 *   is_project_share — 'true' | 'false'
 *   seller_user_id   — creator UUID
 *   buyer_email      — buyer email
 *   content_id       — first track_id
 *   license_id       — first item's license UUID or legacy string
 *   license_type     — 'lease' | 'exclusive' (resolved for first item)
 *   cart_items       — JSON [{track_id, license_id, license_type}]
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Creates a Stripe Checkout session — throttle per IP so it can't be spammed.
  if (!await rateLimitDurable(`sharecheckout:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({})) as ShareCheckoutBody;
    const rawItems = Array.isArray(body.cart_items) ? body.cart_items.filter(isShareCheckoutItem) : [];
    const buyerEmail = typeof body.buyer_email === 'string' ? body.buyer_email.trim() : '';

    if (!rawItems.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }
    if (!isValidEmail(buyerEmail)) {
      return NextResponse.json({ error: 'Valid buyer email required' }, { status: 400 });
    }

    const admin = createServiceClient();

    // ── Resolve the share token ──────────────────────────────────────────────
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
      const projectShare = projShare as ProjectShareCheckoutRow;
      sellerUserId = projectShare.projects?.user_id ?? null;
      projectName = projectShare.projects?.name ?? null;
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
        const linkShareRow = linkShare as LinkShareCheckoutRow;
        sellerUserId = linkShareRow.user_id;
        projectName = linkShareRow.title ?? null;
        shareLeasePrice = linkShareRow.lease_price_usd != null ? Number(linkShareRow.lease_price_usd) : null;
        shareExclusivePrice = linkShareRow.exclusive_price_usd != null ? Number(linkShareRow.exclusive_price_usd) : null;
        shareDiscountPercent = linkShareRow.discount_percent != null ? Number(linkShareRow.discount_percent) : null;
        isProjectShare = false;
      }
    }

    if (!sellerUserId) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    // ── Creator profile fallback prices ─────────────────────────────────────
    const { data: profile } = await admin
      .from('creator_profiles')
      .select('license_lease_price_usd, license_exclusive_price_usd')
      .eq('user_id', sellerUserId)
      .maybeSingle();
    const profileRow = profile as CreatorPriceProfile | null;

    // ── Resolve tracks ────────────────────────────────────────────────────────
    const trackIds = [...new Set(rawItems.map((i) => i.track_id))];
    const { data: tracks } = await admin
      .from('tracks')
      .select('id, title, lease_price_usd, exclusive_price_usd')
      .in('id', trackIds);

    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No matching tracks found' }, { status: 400 });
    }

    // ── Resolve custom license rows ──────────────────────────────────────────
    const customLicenseIds = [...new Set(
      rawItems
        .map((i) => i.license_id)
        .filter(isUUID),
    )];

    const licenseById = new Map<string, CheckoutLicenseRow>();
    if (customLicenseIds.length > 0) {
      const { data: licenseRows } = await admin
        .from('licenses')
        .select('id, name, price_usd, is_exclusive, is_free')
        .eq('user_id', sellerUserId)
        .in('id', customLicenseIds);
      for (const row of (licenseRows ?? []) as CheckoutLicenseRow[]) licenseById.set(row.id, row);
    }

    // Per-track overrides for custom tiers (track_licenses.price_override_usd)
    const trackLicenseOverrides = new Map<string, number | null>();
    if (customLicenseIds.length > 0 && trackIds.length > 0) {
      const { data: overrideRows } = await admin
        .from('track_licenses')
        .select('track_id, license_id, price_override_usd, enabled')
        .in('track_id', trackIds)
        .in('license_id', customLicenseIds);
      for (const row of (overrideRows ?? []) as TrackLicenseOverrideRow[]) {
        trackLicenseOverrides.set(
          `${row.track_id}::${row.license_id}`,
          row.enabled ? (row.price_override_usd ?? null) : null,
        );
      }
    }

    // ── Build Stripe line items ──────────────────────────────────────────────
    const trackById = new Map(((tracks ?? []) as CheckoutTrackRow[]).map((t) => [t.id, t]));
    const lineItems: ShareCheckoutLineItem[] = [];
    const unpriced: string[] = [];
    const cartItemsMeta: Array<{ track_id: string; license_id: string; license_type: string }> = [];

    for (const item of rawItems) {
      const track = trackById.get(item.track_id);
      if (!track) continue;

      const rawLicenseId: string = item.license_id ?? '';
      const isCustomTier = isUUID(rawLicenseId);
      const customLicense = isCustomTier ? licenseById.get(rawLicenseId) : null;

      // Resolve license_type
      const resolvedType: 'lease' | 'exclusive' =
        customLicense?.is_exclusive === true
          ? 'exclusive'
          : rawLicenseId === 'exclusive-rights' || rawLicenseId === 'exclusive'
            ? 'exclusive'
            : 'lease';

      let basePrice: number | null = null;

      if (isCustomTier && customLicense) {
        if (customLicense.is_free) {
          unpriced.push(`${track.title} (free tier not supported here)`);
          continue;
        }
        const overrideKey = `${track.id}::${rawLicenseId}`;
        const trackOverride = trackLicenseOverrides.get(overrideKey);
        // null in map = explicitly disabled on this track
        if (trackOverride === null) {
          unpriced.push(`${track.title} (license not available)`);
          continue;
        }
        basePrice =
          (trackOverride != null && trackOverride > 0 ? trackOverride : null) ??
          (customLicense.price_usd != null && Number(customLicense.price_usd) > 0
            ? Number(customLicense.price_usd)
            : null);
      } else {
        // Legacy two-tier: share override → track override → profile default
        const shareOverride = resolvedType === 'lease' ? shareLeasePrice : shareExclusivePrice;
        const trackOverride = resolvedType === 'lease' ? track.lease_price_usd : track.exclusive_price_usd;
        const profileDefault = resolvedType === 'lease'
          ? profileRow?.license_lease_price_usd
          : profileRow?.license_exclusive_price_usd;

        basePrice =
          shareOverride ??
          (trackOverride != null ? Number(trackOverride) : null) ??
          (profileDefault != null ? Number(profileDefault) : null);
      }

      if (basePrice == null || basePrice <= 0) {
        unpriced.push(track.title);
        continue;
      }

      // Apply discount (share-level; only for legacy path — custom tiers use their own pricing)
      let effective = basePrice;
      if (
        !isCustomTier &&
        shareDiscountPercent != null &&
        shareDiscountPercent > 0 &&
        shareDiscountPercent <= 100
      ) {
        effective = effective * (1 - shareDiscountPercent / 100);
      }

      const displayName = customLicense
        ? `${customLicense.name} — ${track.title}`
        : `${resolvedType === 'exclusive' ? 'Exclusive Rights' : 'Basic Lease'} — ${track.title}`;

      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(effective * 100),
          product_data: {
            name: displayName,
            description: projectName ? projectName.slice(0, 220) : undefined,
          },
        },
        quantity: 1,
      });

      const canonicalLicenseId = isCustomTier ? rawLicenseId : resolvedType;
      cartItemsMeta.push({ track_id: track.id, license_id: canonicalLicenseId, license_type: resolvedType });
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

    // ── Create Stripe Checkout Session ───────────────────────────────────────
    const APP_URL = getAppUrl();
    const stripe = getStripe();
    const sharePath = isProjectShare ? `/projects/share/${token}` : `/share/${token}`;

    const firstItem = cartItemsMeta[0];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: buyerEmail,
      line_items: lineItems,
      metadata: {
        purchase_kind: 'track_license',
        source_surface: 'share_link',
        share_token: token,
        is_project_share: String(isProjectShare),
        seller_user_id: sellerUserId,
        buyer_email: buyerEmail,
        content_id: firstItem.track_id,
        license_id: firstItem.license_id,
        license_type: firstItem.license_type,
        cart_items: JSON.stringify(cartItemsMeta.slice(0, 25)),
      },
      success_url: `${APP_URL}${sharePath}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}${sharePath}?purchase=cancelled`,
    });

    log.info('share checkout session created', { token, session_id: session.id, items: cartItemsMeta.length });
    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (err) {
    log.error('checkout failed', { token, error: errorMessage(err) });
    return publicError(err);
  }
}
