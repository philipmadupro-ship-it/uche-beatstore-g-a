import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.store.checkout');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PromoTerms {
  code: string;
  discountPercent: number;
  discountAmount: number;
}

async function resolvePromo(
  admin: ReturnType<typeof createServiceClient>,
  code: string,
  sellerUserId: string | undefined,
): Promise<{ valid: false; error: string } | { valid: true; terms: PromoTerms | null }> {
  if (!code) return { valid: true, terms: null };

  const { data: row } = await admin
    .from('promo_codes')
    .select('*')
    .ilike('code', code)
    .maybeSingle();

  if (!row) return { valid: false, error: 'Invalid promo code' };
  if (!row.active) return { valid: false, error: 'Promo code is no longer active' };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { valid: false, error: 'Promo code has expired' };
  if (row.max_uses != null && row.uses_count >= row.max_uses) return { valid: false, error: 'Promo code usage limit reached' };
  if (sellerUserId && row.user_id !== sellerUserId) return { valid: false, error: 'Promo code not valid for this seller' };

  return {
    valid: true,
    terms: {
      code: row.code,
      discountPercent: Number(row.discount_percent ?? 0),
      discountAmount: Number(row.discount_amount ?? 0),
    },
  };
}

function applyDiscount(
  lineItems: Array<{ price_data: { unit_amount: number; product_data: { name: string } }; quantity: number }>,
  promo: PromoTerms | null,
): { discountedItems: typeof lineItems; discountTotalCents: number } {
  if (!promo || (promo.discountPercent <= 0 && promo.discountAmount <= 0)) {
    return { discountedItems: lineItems, discountTotalCents: 0 };
  }

  const originalTotalCents = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount, 0);

  if (promo.discountPercent > 0) {
    const discountedItems = lineItems.map((li) => ({
      ...li,
      price_data: {
        ...li.price_data,
        unit_amount: Math.max(1, Math.round(li.price_data.unit_amount * (1 - promo.discountPercent / 100))),
      },
    }));
    const newTotal = discountedItems.reduce((sum, li) => sum + li.price_data.unit_amount, 0);
    return { discountedItems, discountTotalCents: originalTotalCents - newTotal };
  }

  // Flat amount discount — distribute proportionally across line items
  const discountCents = Math.min(Math.round(promo.discountAmount * 100), originalTotalCents - 1);
  let remaining = discountCents;
  const discountedItems = lineItems.map((li, idx) => {
    if (remaining <= 0) return li;
    const share = Math.round((li.price_data.unit_amount / originalTotalCents) * discountCents);
    const actualDiscount = idx === lineItems.length - 1 ? remaining : Math.min(share, remaining);
    remaining -= actualDiscount;
    return {
      ...li,
      price_data: {
        ...li.price_data,
        unit_amount: Math.max(1, li.price_data.unit_amount - actualDiscount),
      },
    };
  });

  return { discountedItems, discountTotalCents: discountCents };
}

/**
 * POST /api/store/checkout
 *   body (track mode):   { buyer_email, items: [{track_id, license_id?, license_type?}] }
 *   body (project mode): { buyer_email, project_id: string }
 *
 * Public-facing Stripe Checkout for /store. Supports track licenses (legacy +
 * custom tiers) and whole-project storefront purchases (price_usd on projects).
 *
 * For projects: the price_usd from the projects row is used; seller is the
 * project owner. Metadata sets purchase_kind: 'project' so webhook creates
 * a project_access_links row and emails the buyer a /projects/share/<token> link.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const buyerEmail = typeof body.buyer_email === 'string' ? body.buyer_email.trim() : '';
    const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
    const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
    const promoCode = typeof body.promo_code === 'string' ? body.promo_code.trim().toUpperCase() : '';

    if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return NextResponse.json({ error: 'Valid buyer email required' }, { status: 400 });
    }
    if (!projectId && !rawItems.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // Validate item shapes only for track purchases.
    if (!projectId) {
      for (const i of rawItems) {
        if (typeof i.track_id !== 'string' || !i.track_id) {
          return NextResponse.json({ error: 'Item missing track_id' }, { status: 400 });
        }
      }
    }

    const admin = createServiceClient();

    // ── Project storefront purchase (price_usd on projects) ────────────────────
    if (projectId) {
      const { data: project, error: pErr } = await admin
        .from('projects')
        .select('id, user_id, name, price_usd, store_featured')
        .eq('id', projectId)
        .maybeSingle();

      if (pErr) throw pErr;
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      const price = project.price_usd != null ? Number(project.price_usd) : 0;
      if (price <= 0) {
        return NextResponse.json({ error: 'Project is not priced for sale' }, { status: 400 });
      }

      const sellerUserId = (project as any).user_id as string | undefined;

      // Validate promo code
      let promo: PromoTerms | null = null;
      if (promoCode) {
        const promoRes = await resolvePromo(admin, promoCode, sellerUserId);
        if (!promoRes.valid) {
          return NextResponse.json({ error: promoRes.error }, { status: 400 });
        }
        promo = promoRes.terms;
      }

      const APP_URL = getAppUrl();
      const stripe = getStripe();

      const lineItems = [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.max(1, Math.round(price * 100)),
          product_data: { name: `Full Project — ${project.name || 'Untitled'}` },
        },
        quantity: 1,
      }];
      const { discountedItems } = applyDiscount(lineItems, promo);

      const session = await stripe.checkout.sessions.create({
        ui_mode: 'embedded_page',
        mode: 'payment',
        customer_email: buyerEmail,
        line_items: discountedItems,
        metadata: {
          purchase_kind: 'project',
          source_surface: 'store',
          project_id: project.id,
          seller_user_id: sellerUserId ?? '',
          buyer_email: buyerEmail,
          content_id: project.id,
          promo_code: promo?.code ?? '',
        },
        // Project bundles land on the Spotify-style listening page
        // (post the access-gate poller that waits for the webhook).
        return_url: `${APP_URL}/store/projects/access?session_id={CHECKOUT_SESSION_ID}`,
      } as any);

      // Increment promo usage
      if (promo) {
        await admin.rpc('increment_promo_uses', { code: promo.code });
      }

      log.info('project checkout session created', { session_id: session.id, project_id: project.id, promo: promo?.code ?? null });
      return NextResponse.json({ client_secret: session.client_secret, session_id: session.id });
    }

    // ── Resolve track records (track license path) ────────────────────────────
    const trackIds = [...new Set(rawItems.map((i: any) => i.track_id as string))];

    const { data: tracks, error: tracksErr } = await admin
      .from('tracks')
      .select('id, user_id, title, store_listed, lease_price_usd, exclusive_price_usd, wav_url, stems_status')
      .in('id', trackIds);

    if (tracksErr) throw tracksErr;
    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No matching tracks found' }, { status: 400 });
    }

    const unlisted = (tracks as any[]).filter((t) => !t.store_listed).map((t: any) => t.title);
    if (unlisted.length) {
      return NextResponse.json({ error: `Not for sale: ${unlisted.join(', ')}` }, { status: 400 });
    }

    // Exclusive deliverable check — used to reject the session up front,
    // now downgraded to a tag. Buyers can still pay for an exclusive even
    // when the producer hasn't uploaded WAV/stems yet; the webhook flags
    // the purchase with needs_stems_upload=true and emails the producer
    // to deliver. Build the list of (track_id, title) pairs that are
    // missing so the webhook + the buyer's confirmation copy can use it.
    const stemsReady = (stemsStatus: string | null | undefined) =>
      stemsStatus === 'ready' || stemsStatus === 'done' || stemsStatus === 'complete';
    const missingDeliverableTracks = rawItems
      .map((it) => {
        if (it.license_type !== 'exclusive' && it.license_type !== 'exclusive-rights') return null;
        const track = (tracks as any[]).find((t) => t.id === it.track_id);
        if (!track) return null;
        if (track.wav_url || stemsReady(track.stems_status)) return null;
        return { id: track.id as string, title: track.title as string };
      })
      .filter((x): x is { id: string; title: string } => !!x);

    // ── Creator profile (for legacy price fallback) ──────────────────────────
    const sellerUserId = (tracks[0] as any).user_id as string | undefined;
    let profileLease: number | null = null;
    let profileExclusive: number | null = null;
    if (sellerUserId) {
      const { data: profile } = await admin
        .from('creator_profiles')
        .select('license_lease_price_usd, license_exclusive_price_usd')
        .eq('user_id', sellerUserId)
        .maybeSingle();
      profileLease = profile?.license_lease_price_usd ?? null;
      profileExclusive = profile?.license_exclusive_price_usd ?? null;
    }

    // Validate promo code for this seller
    let promo: PromoTerms | null = null;
    if (promoCode) {
      const promoRes = await resolvePromo(admin, promoCode, sellerUserId);
      if (!promoRes.valid) {
        return NextResponse.json({ error: promoRes.error }, { status: 400 });
      }
      promo = promoRes.terms;
    }

    // ── Resolve custom license rows ──────────────────────────────────────────
    // Collect the UUIDs that look like proper UUIDs (v4 format) to query the
    // licenses table. Legacy values like 'lease' / 'basic-lease' / 'exclusive-rights'
    // are not UUIDs and fall through to the legacy price logic.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const customLicenseIds = [...new Set(
      rawItems
        .map((i: any) => i.license_id)
        .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    )];

    // Map license_id → license row
    const licenseById = new Map<string, any>();
    if (customLicenseIds.length > 0) {
      const { data: licenseRows } = await admin
        .from('licenses')
        .select('id, name, price_usd, is_exclusive, is_free, file_types, stems_included')
        .in('id', customLicenseIds);
      for (const row of licenseRows ?? []) licenseById.set(row.id, row);
    }

    // Resolve per-track overrides for custom license tiers.
    // track_licenses.price_override_usd takes highest priority.
    const trackLicenseOverrides = new Map<string, number | null>(); // key: `${track_id}::${license_id}`
    if (customLicenseIds.length > 0 && trackIds.length > 0) {
      const { data: overrideRows } = await admin
        .from('track_licenses')
        .select('track_id, license_id, price_override_usd, enabled')
        .in('track_id', trackIds)
        .in('license_id', customLicenseIds);
      for (const row of overrideRows ?? []) {
        const key = `${row.track_id}::${row.license_id}`;
        // Mark disabled entries with null so they can be rejected below.
        trackLicenseOverrides.set(key, row.enabled ? (row.price_override_usd ?? null) : null);
      }
    }

    // ── Build Stripe line items ──────────────────────────────────────────────
    const trackById = new Map((tracks as any[]).map((t) => [t.id, t]));
    const lineItems: any[] = [];
    const unpriced: string[] = [];
    const cartItemsMeta: Array<{ track_id: string; license_id: string; license_type: string }> = [];

    for (const it of rawItems) {
      const track = trackById.get(it.track_id) as any;
      if (!track) continue;

      const rawLicenseId: string = it.license_id ?? '';
      const isCustomTier = UUID_RE.test(rawLicenseId);
      const customLicense = isCustomTier ? licenseById.get(rawLicenseId) : null;

      // Determine resolved license_type ('lease' | 'exclusive') from either
      // the custom DB row or the legacy type string passed by the client.
      const resolvedType: 'lease' | 'exclusive' =
        customLicense?.is_exclusive === true
          ? 'exclusive'
          : rawLicenseId === 'exclusive-rights' || rawLicenseId === 'exclusive' || it.license_type === 'exclusive'
            ? 'exclusive'
            : 'lease';

      // Price resolution:
      let effectivePrice: number | null = null;

      if (isCustomTier && customLicense) {
        const overrideKey = `${track.id}::${rawLicenseId}`;
        const trackOverride = trackLicenseOverrides.get(overrideKey);

        // null in map means explicitly disabled for this track
        if (trackOverride === null) {
          unpriced.push(`${track.title} (license not available)`);
          continue;
        }
        // Use track-level override → custom license base price
        const base = trackOverride != null && trackOverride > 0
          ? trackOverride
          : (customLicense.price_usd != null && Number(customLicense.price_usd) > 0
              ? Number(customLicense.price_usd)
              : null);
        if (customLicense.is_free) {
          unpriced.push(`${track.title} (free tier not supported in cart checkout)`);
          continue;
        }
        effectivePrice = base;
      } else {
        // Legacy two-tier resolution
        const trackOverride = resolvedType === 'lease'
          ? track.lease_price_usd
          : track.exclusive_price_usd;
        const profileDefault = resolvedType === 'lease' ? profileLease : profileExclusive;

        effectivePrice =
          (trackOverride != null && Number(trackOverride) > 0 ? Number(trackOverride) : null) ??
          (profileDefault != null && Number(profileDefault) > 0 ? Number(profileDefault) : null);
      }

      if (effectivePrice == null || effectivePrice <= 0) {
        unpriced.push(`${track.title} (${resolvedType})`);
        continue;
      }

      const displayName = customLicense
        ? `${customLicense.name} — ${track.title}`
        : `${resolvedType === 'exclusive' ? 'Exclusive' : 'Lease'} — ${track.title}`;

      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(effectivePrice * 100),
          product_data: { name: displayName },
        },
        quantity: 1,
      });

      // canonical license_id for metadata — use UUID if custom, else legacy string
      const canonicalLicenseId = isCustomTier ? rawLicenseId : resolvedType;
      cartItemsMeta.push({ track_id: track.id, license_id: canonicalLicenseId, license_type: resolvedType });
    }

    if (unpriced.length) {
      return NextResponse.json({ error: `Missing price on: ${unpriced.join(', ')}` }, { status: 400 });
    }
    if (!lineItems.length) {
      return NextResponse.json({ error: 'No valid items to charge' }, { status: 400 });
    }

    // Apply promo discount before creating Stripe session
    const { discountedItems } = applyDiscount(lineItems, promo);

    // ── Create Stripe Embedded Checkout Session ──────────────────────────────
    const APP_URL = getAppUrl();
    const stripe = getStripe();

    // Headline fields for the webhook (derived from first item for backward compat)
    const firstItem = cartItemsMeta[0];

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      customer_email: buyerEmail,
      line_items: discountedItems,
      metadata: {
        // Routing / fulfillment discriminators
        purchase_kind: 'track_license',
        source_surface: 'store',
        // Headline identifiers (webhook backward compat)
        content_id: firstItem.track_id,
        license_id: firstItem.license_id,
        license_type: firstItem.license_type,
        // Parties
        seller_user_id: sellerUserId ?? '',
        buyer_email: buyerEmail,
        // Full cart (capped at 25 items to stay within Stripe 500-char limit)
        cart_items: JSON.stringify(cartItemsMeta.slice(0, 25)),
        promo_code: promo?.code ?? '',
        // Exclusive purchases of tracks with no WAV / no ready stems —
        // webhook reads this and flags the purchase + emails the
        // producer to upload. Comma-separated track ids; "" when none.
        stems_pending_track_ids: missingDeliverableTracks.map((t) => t.id).join(','),
      },
      return_url: `${APP_URL}/store/download?session_id={CHECKOUT_SESSION_ID}`,
    } as any);

    // Increment promo usage
    if (promo) {
      await admin.rpc('increment_promo_uses', { code: promo.code });
    }

    log.info('store checkout session created', { session_id: session.id, items: cartItemsMeta.length, promo: promo?.code ?? null });
    return NextResponse.json({ client_secret: session.client_secret, session_id: session.id });
  } catch (err) {
    log.error('store checkout failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
