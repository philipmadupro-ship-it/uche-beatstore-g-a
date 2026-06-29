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
import { applyDiscount, applyBundleDiscount, type PromoTerms, type LineItems } from '@/lib/store/discount';
import { needsStemsUpload } from '@/lib/stems/readiness';
import { resolveLicenseType } from '@/lib/store/license-type';

const log = createLogger('api.store.checkout');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckoutBody = {
  buyer_email?: unknown;
  items?: unknown;
  project_id?: unknown;
  promo_code?: unknown;
};

type RawCartItem = {
  track_id: string;
  license_id?: string;
  license_type?: string;
};

type ProjectRow = {
  id: string;
  user_id?: string | null;
  name?: string | null;
  price_usd?: number | string | null;
};

type TrackRow = {
  id: string;
  user_id?: string | null;
  title?: string | null;
  store_listed?: boolean | null;
  exclusive_sold?: boolean | null;
  lease_price_usd?: number | string | null;
  exclusive_price_usd?: number | string | null;
  wav_url?: string | null;
  stems_status?: string | null;
};

type CreatorProfileRow = {
  license_lease_price_usd?: number | string | null;
  license_exclusive_price_usd?: number | string | null;
  bundle_discount_threshold?: number | string | null;
  bundle_discount_percent?: number | string | null;
};

type LicenseRow = {
  id: string;
  name?: string | null;
  price_usd?: number | string | null;
  is_exclusive?: boolean | null;
  is_free?: boolean | null;
};

type TrackLicenseOverrideRow = {
  track_id: string;
  license_id: string;
  price_override_usd?: number | string | null;
  enabled?: boolean | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function resolvePromo(
  admin: ReturnType<typeof createServiceClient>,
  code: string,
  sellerUserId: string | undefined,
): Promise<{ valid: false; error: string } | { valid: true; terms: PromoTerms | null }> {
  if (!code) return { valid: true, terms: null };

  // `code` is already trimmed + upper-cased by the caller, and stored codes
  // are canonical upper-case — exact match hits the `code` PK index instead
  // of an unindexed ILIKE scan.
  const { data: row } = await admin
    .from('promo_codes')
    .select('*')
    .eq('code', code)
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
    // Per-IP limit — each call creates a Stripe session (+ abandoned_carts
    // row). Caps session/cart spam without throttling a real buyer.
    if (!(await rateLimitDurable(`checkout:${clientIp(req)}`, 8, 60_000))) {
      return NextResponse.json({ error: 'Too many checkout attempts — try again shortly.' }, { status: 429 });
    }
    const body = await req.json().catch(() => ({})) as CheckoutBody;
    const buyerEmail = typeof body.buyer_email === 'string' ? body.buyer_email.trim() : '';
    const candidateItems = Array.isArray(body.items) ? body.items : [];
    const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
    const promoCode = typeof body.promo_code === 'string' ? body.promo_code.trim().toUpperCase() : '';

    if (!isValidEmail(buyerEmail)) {
      return NextResponse.json({ error: 'Valid buyer email required' }, { status: 400 });
    }
    if (!projectId && !candidateItems.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // Validate item shapes only for track purchases.
    const rawItems: RawCartItem[] = [];
    if (!projectId) {
      for (const i of candidateItems) {
        if (!isRecord(i) || typeof i.track_id !== 'string' || !i.track_id) {
          return NextResponse.json({ error: 'Item missing track_id' }, { status: 400 });
        }
        rawItems.push({
          track_id: i.track_id,
          license_id: typeof i.license_id === 'string' ? i.license_id : undefined,
          license_type: typeof i.license_type === 'string' ? i.license_type : undefined,
        });
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
      const projectRow = project as ProjectRow;
      const price = projectRow.price_usd != null ? Number(projectRow.price_usd) : 0;
      if (price <= 0) {
        return NextResponse.json({ error: 'Project is not priced for sale' }, { status: 400 });
      }

      const sellerUserId = projectRow.user_id ?? undefined;

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
          product_data: { name: `Full Project — ${projectRow.name || 'Untitled'}` },
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
          project_id: projectRow.id,
          seller_user_id: sellerUserId ?? '',
          buyer_email: buyerEmail,
          content_id: projectRow.id,
          promo_code: promo?.code ?? '',
        },
        // Project bundles land on the Spotify-style listening page
        // (post the access-gate poller that waits for the webhook).
        return_url: `${APP_URL}/store/projects/access?session_id={CHECKOUT_SESSION_ID}`,
      });

      // Increment promo usage
      if (promo) {
        await admin.rpc('increment_promo_uses', { code: promo.code });
      }

      log.info('project checkout session created', { session_id: session.id, project_id: projectRow.id, promo: promo?.code ?? null });
      return NextResponse.json({ client_secret: session.client_secret, session_id: session.id });
    }

    // ── Resolve track records (track license path) ────────────────────────────
    const trackIds = [...new Set(rawItems.map((i) => i.track_id))];

    const { data: tracks, error: tracksErr } = await admin
      .from('tracks')
      .select('id, user_id, title, store_listed, exclusive_sold, lease_price_usd, exclusive_price_usd, wav_url, stems_status')
      .in('id', trackIds);

    if (tracksErr) throw tracksErr;
    const trackRows = (tracks ?? []) as TrackRow[];
    if (trackRows.length === 0) {
      return NextResponse.json({ error: 'No matching tracks found' }, { status: 400 });
    }

    const unlisted = trackRows.filter((t) => !t.store_listed).map((t) => t.title ?? 'Untitled');
    if (unlisted.length) {
      return NextResponse.json({ error: `Not for sale: ${unlisted.join(', ')}` }, { status: 400 });
    }

    // Exclusive-sold guard (mig 075). Once a beat's exclusive rights have sold,
    // it can't be licensed again under ANY tier — the client hides the buttons,
    // but this server check is the authoritative gate against a forged request.
    const soldOut = trackRows.filter((t) => t.exclusive_sold).map((t) => t.title ?? 'Untitled');
    if (soldOut.length) {
      return NextResponse.json(
        { error: `Exclusive rights already sold: ${soldOut.join(', ')}` },
        { status: 409 },
      );
    }

    // ── Creator profile (for legacy price fallback) ──────────────────────────
    const sellerUserId = trackRows[0]?.user_id ?? undefined;
    let profileLease: number | null = null;
    let profileExclusive: number | null = null;
    let bundleRule: { threshold: number; percent: number } | null = null;
    if (sellerUserId) {
      const { data: profile } = await admin
        .from('creator_profiles')
        .select('license_lease_price_usd, license_exclusive_price_usd, bundle_discount_threshold, bundle_discount_percent')
        .eq('user_id', sellerUserId)
        .maybeSingle();
      const profileRow = profile as CreatorProfileRow | null;
      profileLease = profileRow?.license_lease_price_usd != null ? Number(profileRow.license_lease_price_usd) : null;
      profileExclusive = profileRow?.license_exclusive_price_usd != null ? Number(profileRow.license_exclusive_price_usd) : null;
      const threshold = Number(profileRow?.bundle_discount_threshold ?? 0);
      const percent = Number(profileRow?.bundle_discount_percent ?? 0);
      if (threshold > 0 && percent > 0) bundleRule = { threshold, percent };
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
    const customLicenseIds = [...new Set(
      rawItems
        .map((i) => i.license_id)
        .filter(isUUID)
    )];

    // Map license_id → license row
    const licenseById = new Map<string, LicenseRow>();
    if (customLicenseIds.length > 0) {
      const { data: licenseRows } = await admin
        .from('licenses')
        .select('id, name, price_usd, is_exclusive, is_free, file_types, stems_included')
        .in('id', customLicenseIds);
      for (const row of (licenseRows ?? []) as LicenseRow[]) licenseById.set(row.id, row);
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
      for (const row of (overrideRows ?? []) as TrackLicenseOverrideRow[]) {
        const key = `${row.track_id}::${row.license_id}`;
        // Mark disabled entries with null so they can be rejected below.
        trackLicenseOverrides.set(
          key,
          row.enabled ? (row.price_override_usd != null ? Number(row.price_override_usd) : null) : null,
        );
      }
    }

    // ── Build Stripe line items ──────────────────────────────────────────────
    const trackById = new Map(trackRows.map((t) => [t.id, t]));
    const lineItems: LineItems = [];
    const unpriced: string[] = [];
    const missingDeliverableTracks: Array<{ id: string; title: string }> = [];
    const cartItemsMeta: Array<{ track_id: string; license_id: string; license_type: string }> = [];

    for (const it of rawItems) {
      const track = trackById.get(it.track_id);
      if (!track) continue;

      const rawLicenseId = it.license_id ?? '';
      const isCustomTier = isUUID(rawLicenseId);
      const customLicense = isCustomTier ? licenseById.get(rawLicenseId) : null;

      // Determine resolved license_type ('lease' | 'exclusive') from either
      // the custom DB row or the legacy type string passed by the client.
      const resolvedType = resolveLicenseType(rawLicenseId, licenseById, it.license_type);

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

      if (resolvedType === 'exclusive' && needsStemsUpload(track)) {
        missingDeliverableTracks.push({ id: track.id, title: track.title ?? 'Untitled' });
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
    if (missingDeliverableTracks.length) {
      return NextResponse.json(
        { error: `Exclusive delivery not ready for: ${missingDeliverableTracks.map((t) => t.title).join(', ')}` },
        { status: 400 },
      );
    }
    if (!lineItems.length) {
      return NextResponse.json({ error: 'No valid items to charge' }, { status: 400 });
    }

    // Automatic bundle/quantity discount first (Task 7), then any promo code
    // stacks on the bundled price.
    const bundle = applyBundleDiscount(lineItems, bundleRule);
    const { discountedItems } = applyDiscount(bundle.items, promo);

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
        bundle_discount_percent: bundle.applied ? String(bundle.percent) : '',
        stems_pending_track_ids: '',
      },
      return_url: `${APP_URL}/store/download?session_id={CHECKOUT_SESSION_ID}`,
    });

    // Increment promo usage
    if (promo) {
      await admin.rpc('increment_promo_uses', { code: promo.code });
    }

    // Abandoned-cart capture (mig 071). Best-effort — the webhook flips
    // recovered=true on completion; a cron reminds the rest after ~1h.
    try {
      const totalCents = discountedItems.reduce((s, li) => s + li.price_data.unit_amount * (li.quantity ?? 1), 0);
      await admin.from('abandoned_carts').insert({
        stripe_session_id: session.id,
        seller_user_id: sellerUserId || null,
        buyer_email: buyerEmail,
        items: discountedItems.map((li) => ({ name: li.price_data.product_data.name, price_usd: li.price_data.unit_amount / 100 })),
        item_count: cartItemsMeta.length,
        total_usd: totalCents / 100,
      });
    } catch (e) {
      log.warn('abandoned-cart capture failed', { error: errorMessage(e) });
    }

    log.info('store checkout session created', { session_id: session.id, items: cartItemsMeta.length, promo: promo?.code ?? null });
    return NextResponse.json({ client_secret: session.client_secret, session_id: session.id });
  } catch (err) {
    log.error('store checkout failed', { error: errorMessage(err) });
    return publicError(err);
  }
}
