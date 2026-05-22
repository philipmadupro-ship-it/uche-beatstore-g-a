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

      const APP_URL = getAppUrl();
      const stripe = getStripe();

      const session = await stripe.checkout.sessions.create({
        ui_mode: 'embedded_page',
        mode: 'payment',
        customer_email: buyerEmail,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(price * 100),
            product_data: { name: `Full Project — ${project.name || 'Untitled'}` },
          },
          quantity: 1,
        }],
        metadata: {
          purchase_kind: 'project',
          source_surface: 'store',
          project_id: project.id,
          seller_user_id: sellerUserId ?? '',
          buyer_email: buyerEmail,
          content_id: project.id,
        },
        return_url: `${APP_URL}/store/download?session_id={CHECKOUT_SESSION_ID}`,
      } as any);

      log.info('project checkout session created', { session_id: session.id, project_id: project.id });
      return NextResponse.json({ client_secret: session.client_secret, session_id: session.id });
    }

    // ── Resolve track records (track license path) ────────────────────────────
    const trackIds = [...new Set(rawItems.map((i: any) => i.track_id as string))];

    const { data: tracks, error: tracksErr } = await admin
      .from('tracks')
      .select('id, user_id, title, store_listed, lease_price_usd, exclusive_price_usd')
      .in('id', trackIds);

    if (tracksErr) throw tracksErr;
    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No matching tracks found' }, { status: 400 });
    }

    const unlisted = (tracks as any[]).filter((t) => !t.store_listed).map((t: any) => t.title);
    if (unlisted.length) {
      return NextResponse.json({ error: `Not for sale: ${unlisted.join(', ')}` }, { status: 400 });
    }

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

    // ── Create Stripe Embedded Checkout Session ──────────────────────────────
    const APP_URL = getAppUrl();
    const stripe = getStripe();

    // Headline fields for the webhook (derived from first item for backward compat)
    const firstItem = cartItemsMeta[0];

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      customer_email: buyerEmail,
      line_items: lineItems,
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
      },
      return_url: `${APP_URL}/store/download?session_id={CHECKOUT_SESSION_ID}`,
    } as any);

    log.info('store checkout session created', { session_id: session.id, items: cartItemsMeta.length });
    return NextResponse.json({ client_secret: session.client_secret, session_id: session.id });
  } catch (err) {
    log.error('store checkout failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
