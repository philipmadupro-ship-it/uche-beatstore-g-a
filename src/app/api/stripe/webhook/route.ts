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
 * Single endpoint for all Stripe events. Fulfillment branches on metadata
 * instead of per-license handler files.
 *
 * ── Signature verification ─────────────────────────────────────────────────
 * Raw request body is required for HMAC verification. Any buffering/parsing
 * before constructEvent() breaks the signature. We use req.text() to preserve
 * the exact bytes Stripe signed.
 *
 * ── Idempotency (two layers) ───────────────────────────────────────────────
 * Layer 1 — Event-level: processed_stripe_events stores every event.id we
 *   successfully handled. On retry the row already exists → return 200 fast.
 * Layer 2 — Purchase-level:
 *   • track_license  → license_purchases.stripe_session_id UNIQUE
 *   • project        → project_access_links.stripe_session_id (unique per buy)
 *
 * ── Fulfillment rules per purchase kind ────────────────────────────────────
 *   track_license (lease/exclusive/custom) — email + download; exclusive also
 *     delists the track (store_listed=false).
 *   project        — create project_access_links row (with unique token) +
 *     delivery email pointing to /store/projects/access/<token>. Buyer gets
 *     a token-gated delivery page with per-track WAV/MP3 download links.
 *
 * ── Background processing ─────────────────────────────────────────────────
 * The critical path (signature verify + purchase upsert + event log insert)
 * completes and returns 200 before heavy work runs. Async tasks:
 *   • CRM contact upsert (for both track and project buys)
 *   • Exclusivity lock (store_listed=false on tracks)
 *   • Delivery email (track uses fulfillment_email_sent guard; project relies
 *     on event-level dedup to avoid dups)
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCartItems(raw: string): Array<{ track_id: string; license_id: string; license_type: string }> {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i: any) => typeof i === 'object' && i !== null && typeof i.track_id === 'string',
    );
  } catch {
    return [];
  }
}

/** Map a raw license_id string to a canonical DB license_type.
 *  UUIDs are resolved via the license rows fetched from the DB.
 *  Legacy strings ('lease', 'basic-lease', 'exclusive-rights', …) are normalised here. */
function resolveTypeFromRaw(
  raw: string,
  licenseById: Map<string, any>,
): 'lease' | 'exclusive' {
  if (UUID_RE.test(raw)) {
    const row = licenseById.get(raw);
    return row?.is_exclusive === true ? 'exclusive' : 'lease';
  }
  return raw === 'exclusive-rights' || raw === 'exclusive' ? 'exclusive' : 'lease';
}

// ── Background fulfillment ──────────────────────────────────────────────────

async function runFulfillment(params: {
  session: any;
  meta: Record<string, string>;
  purchaseId: string;
  trackIds: string[];
  lineItems: Array<{ track_id: string; license_id: string; license_type: string }>;
  hasAnyExclusive: boolean;
}) {
  const { session, meta, purchaseId, trackIds, lineItems, hasAnyExclusive } = params;
  const admin = createServiceClient();
  const APP_URL = getAppUrl();

  // 1. CRM — upsert buyer into the seller's contacts list
  if (meta.seller_user_id && meta.buyer_email) {
    try {
      const { data: existing } = await admin
        .from('contacts')
        .select('id')
        .eq('user_id', meta.seller_user_id)
        .eq('email', meta.buyer_email)
        .maybeSingle();

      if (!existing) {
        await admin.from('contacts').insert({
          user_id: meta.seller_user_id,
          name: session.customer_details?.name || 'Customer',
          email: meta.buyer_email,
          role: 'artist',
          label: 'buyer',
          notes: `Purchased via ${meta.source_surface === 'store' ? 'store' : 'share link'}`,
          buyer_pipeline_status: 'purchased',
        });
      } else {
        // Ensure pipeline status is updated even for returning buyers
        await admin
          .from('contacts')
          .update({ buyer_pipeline_status: 'purchased' })
          .eq('user_id', meta.seller_user_id)
          .eq('email', meta.buyer_email);
      }
    } catch (err) {
      log.warn('CRM upsert failed', { error: errorMessage(err) });
    }
  }

  // 2. Exclusivity lock — for any exclusive item, delist the track
  if (hasAnyExclusive) {
    const exclusiveTrackIds = lineItems
      .filter((li) => li.license_type === 'exclusive')
      .map((li) => li.track_id);

    if (exclusiveTrackIds.length > 0) {
      try {
        const { error } = await admin
          .from('tracks')
          .update({ store_listed: false })
          .in('id', exclusiveTrackIds);
        if (error) {
          log.warn('exclusivity lock failed', { trackIds: exclusiveTrackIds, error: errorMessage(error) });
        } else {
          log.info('exclusive tracks delisted', { trackIds: exclusiveTrackIds });
        }
      } catch (err) {
        log.warn('exclusivity lock threw', { error: errorMessage(err) });
      }
    }
  }

  // 3. Delivery email — guarded by fulfillment_email_sent flag to prevent duplicates
  if (process.env.RESEND_API_KEY && meta.buyer_email) {
    try {
      // Re-fetch the flag in case a concurrent execution already sent the email
      const { data: purchaseRow } = await admin
        .from('license_purchases')
        .select('fulfillment_email_sent')
        .eq('id', purchaseId)
        .maybeSingle();

      if (purchaseRow?.fulfillment_email_sent === true) {
        log.info('fulfillment email already sent, skipping', { purchaseId });
        return;
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      const sourceSurface = meta.source_surface ?? 'store';
      const isStore = sourceSurface === 'store';
      const isProjShare = meta.is_project_share !== 'false';

      const downloadUrl = isStore
        ? `${APP_URL}/store/download?session_id=${session.id}`
        : isProjShare
          ? `${APP_URL}/projects/share/${meta.share_token}`
          : `${APP_URL}/share/${meta.share_token}`;

      // Build a per-item delivery note for custom tiers vs legacy types
      const itemSummaries = lineItems.map((li) => {
        const typeLabel = li.license_type === 'exclusive' ? 'Exclusive' : 'Lease';
        return `• ${typeLabel} license — Track ID: ${li.track_id}`;
      });

      // Promo + totals breakdown. Stripe gives us the final paid total +
      // any discounts it applied; surface them so the buyer sees what
      // their code did.
      const totalCents = Number(session.amount_total ?? 0);
      const subtotalCents = Number(session.amount_subtotal ?? totalCents);
      const discountCents = Math.max(0, subtotalCents - totalCents);
      const fmt = (cents: number) =>
        `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const promoLine = meta.promo_code
        ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:#6DC6A4;margin-top:8px;">
             <span>Promo ${meta.promo_code} applied</span>
             <span>−${fmt(discountCents)}</span>
           </div>`
        : '';

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: meta.buyer_email,
        subject: `Your license${lineItems.length > 1 ? 's are' : ' is'} ready`,
        html: `
          <div style="font-family: sans-serif; background: #0a0907; color: #E8DCC8; padding: 40px; border-radius: 20px; max-width: 560px;">
            <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #D4BFA0; margin: 0 0 20px;">
              Purchase complete
            </h1>
            <p style="font-size: 15px; line-height: 1.7; color: #E8DCC8;">
              Thanks for your purchase. Your license${lineItems.length > 1 ? 's are' : ' is'} now active and your files are ready to download.
            </p>
            <div style="margin: 24px 0; padding: 16px; background: #14110d; border-radius: 12px; border: 1px solid #1f1a13; font-size: 12px; color: #a08a6a; font-family: monospace; line-height: 1.8;">
              ${itemSummaries.join('<br/>')}
              <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #1f1a13;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#a08a6a;">
                  <span>Subtotal</span><span>${fmt(subtotalCents)}</span>
                </div>
                ${promoLine}
                <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:bold;color:#E8DCC8;margin-top:8px;">
                  <span>Total paid</span><span>${fmt(totalCents)}</span>
                </div>
              </div>
            </div>
            <div style="margin-top: 36px;">
              <a href="${downloadUrl}"
                 style="background: #E8DCC8; color: #0a0907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
                Download your files
              </a>
            </div>
            <p style="margin-top: 48px; font-size: 10px; color: #4a4338; text-transform: uppercase; letter-spacing: 0.5em;">
              Questions? Reply to this email or contact support.
            </p>
          </div>
        `,
      });

      // Mark email sent — idempotency guard for retries
      await admin
        .from('license_purchases')
        .update({ fulfillment_email_sent: true })
        .eq('id', purchaseId);

      log.info('delivery email sent', { purchaseId, to: meta.buyer_email });
    } catch (err) {
      log.warn('delivery email failed', { purchaseId, error: errorMessage(err) });
    }
  }
}

// ── Project storefront fulfillment ────────────────────────────────────────────

async function runProjectFulfillment(params: {
  session: any;
  meta: Record<string, string>;
  accessId: string;
  accessToken: string;
  projectId: string;
}) {
  const { session, meta, accessId, accessToken, projectId } = params;
  const admin = createServiceClient();
  const APP_URL = getAppUrl();

  // 1. CRM — upsert buyer (reuse pattern)
  if (meta.seller_user_id && meta.buyer_email) {
    try {
      const { data: existing } = await admin
        .from('contacts')
        .select('id')
        .eq('user_id', meta.seller_user_id)
        .eq('email', meta.buyer_email)
        .maybeSingle();

      if (!existing) {
        await admin.from('contacts').insert({
          user_id: meta.seller_user_id,
          name: session.customer_details?.name || 'Customer',
          email: meta.buyer_email,
          role: 'artist',
          label: 'buyer',
          notes: `Purchased project via store`,
          buyer_pipeline_status: 'purchased',
        });
      } else {
        await admin
          .from('contacts')
          .update({ buyer_pipeline_status: 'purchased' })
          .eq('user_id', meta.seller_user_id)
          .eq('email', meta.buyer_email);
      }
    } catch (err) {
      log.warn('project CRM upsert failed', { error: errorMessage(err) });
    }
  }

  // 2. Delivery email (no per-row email flag on project_access_links; rely on event dedup)
  if (process.env.RESEND_API_KEY && meta.buyer_email) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Fetch project name for nicer email
      let projName = 'Project';
      try {
        const { data: p } = await admin
          .from('projects')
          .select('name')
          .eq('id', projectId)
          .maybeSingle();
        if (p?.name) projName = p.name;
      } catch {}

      const accessUrl = `${APP_URL}/store/projects/access/${accessToken}`;

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: meta.buyer_email,
        subject: `Your project "${projName}" is ready`,
        html: `
          <div style="font-family: sans-serif; background: #0a0907; color: #E8DCC8; padding: 40px; border-radius: 20px; max-width: 560px;">
            <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #D4BFA0; margin: 0 0 20px;">
              Project purchase complete
            </h1>
            <p style="font-size: 15px; line-height: 1.7; color: #E8DCC8;">
              Thanks for your purchase. You now have full access to all tracks in <strong>${projName}</strong>.
            </p>
            <div style="margin-top: 36px;">
              <a href="${accessUrl}"
                 style="background: #E8DCC8; color: #0a0907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
                Access your project
              </a>
            </div>
            <p style="margin-top: 48px; font-size: 10px; color: #4a4338; text-transform: uppercase; letter-spacing: 0.5em;">
              The link above lets you stream and download every track in the project.
            </p>
          </div>
        `,
      });

      log.info('project delivery email sent', { accessId, projectId, to: meta.buyer_email });
    } catch (err) {
      log.warn('project delivery email failed', { accessId, error: errorMessage(err) });
    }
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Signature verification ────────────────────────────────────────────────
  const signature = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // MUST read raw bytes before any JSON parsing — Stripe HMAC covers the exact body
  const rawBody = await req.text();
  const stripe = getStripe();
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    log.warn('signature verification failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 });
  }

  const admin = createServiceClient();

  try {
    switch (event.type) {

      // ── checkout.session.completed ─────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const meta: Record<string, string> = session.metadata ?? {};

        // ── Layer 1 idempotency: event-level ──────────────────────────────
        // INSERT ... ON CONFLICT DO NOTHING returns rowCount=0 if duplicate
        const { error: eventInsertErr, count: eventInsertCount } = await admin
          .from('processed_stripe_events')
          .insert({ event_id: event.id })
          .select('event_id');

        // Supabase returns null count when INSERT succeeds; conflict means we
        // already processed this exact event delivery — return 200 immediately.
        if (eventInsertErr) {
          // Duplicate key → already processed
          const isDuplicate =
            eventInsertErr.code === '23505' || // unique_violation
            eventInsertErr.message?.includes('duplicate') ||
            eventInsertErr.message?.includes('already exists');
          if (isDuplicate) {
            log.info('duplicate event, skipping', { event_id: event.id });
            return NextResponse.json({ received: true, skipped: true });
          }
          // Real DB error — bubble up so Stripe retries
          throw eventInsertErr;
        }

        const purchaseKind = meta.purchase_kind ?? 'track_license';

        // ── Promo redemption — atomic increment (migration 048) ─────────
        // Closes the race where two buyers can both see uses_count <
        // max_uses, both create sessions, and both complete. The RPC
        // returns NULL when the cap was reached between create + complete.
        // Stripe already collected the (discounted) money, so we honour
        // the session either way and just log the over-redemption.
        const promoCode = meta.promo_code;
        if (promoCode) {
          try {
            const { data: incrementedRow, error: rpcErr } = await admin.rpc(
              'increment_promo_use',
              { p_code: promoCode },
            );
            if (rpcErr) {
              log.warn('promo increment failed', { code: promoCode, error: errorMessage(rpcErr) });
            } else if (!incrementedRow) {
              log.warn('promo exhausted between session create and complete', {
                code: promoCode,
                session_id: session.id,
              });
            }
          } catch (err) {
            log.warn('promo increment threw', { code: promoCode, error: errorMessage(err) });
          }
        }

        if (purchaseKind === 'project') {
          // ── Project storefront purchase ─────────────────────────────────
          const projectId = meta.project_id;
          if (!projectId) {
            log.warn('project purchase missing project_id in metadata', { session_id: session.id });
            return NextResponse.json({ received: true });
          }

          // Layer 2: project_access_links by stripe_session_id (idempotent)
          const { data: existingAccess } = await admin
            .from('project_access_links')
            .select('id, token')
            .eq('stripe_session_id', session.id)
            .maybeSingle();

          if (existingAccess) {
            log.info('project access row exists, re-running fulfillment', { session_id: session.id });
            void runProjectFulfillment({
              session,
              meta,
              accessId: existingAccess.id,
              accessToken: existingAccess.token,
              projectId,
            });
            return NextResponse.json({ received: true });
          }

          // Create delivery token row (token auto-generated by DB).
          // amount_usd is frozen here from session.amount_total so the
          // producer's later price changes don't rewrite this row's history.
          const { data: createdAccess, error: accessInsertErr } = await admin
            .from('project_access_links')
            .insert({
              project_id: projectId,
              buyer_email: meta.buyer_email || session.customer_email || 'unknown@invalid',
              stripe_session_id: session.id,
              amount_usd: (session.amount_total ?? 0) / 100,
            })
            .select('id, token')
            .single();

          if (accessInsertErr) throw accessInsertErr;

          const accessId = createdAccess.id;
          const accessToken = createdAccess.token;

          // Fire-and-forget fulfillment (CRM + email with /store/projects/access/${token})
          void runProjectFulfillment({
            session,
            meta,
            accessId,
            accessToken,
            projectId,
          });

          log.info('project purchase fulfilled', {
            session_id: session.id,
            project_id: projectId,
            access_id: accessId,
          });
        } else {
          // ── Track license purchase (original flow) ──────────────────────
          // ── Layer 2 idempotency: purchase-level ───────────────────────────
          const { data: existingPurchase } = await admin
            .from('license_purchases')
            .select('id, fulfillment_email_sent')
            .eq('stripe_session_id', session.id)
            .maybeSingle();

          if (existingPurchase) {
            // Purchase row already exists (e.g. a previous delivery that timed out
            // after DB write but before 200 response). Still run background tasks
            // in case they didn't complete.
            log.info('purchase row exists, re-running fulfillment', { session_id: session.id });
            const cartItems = parseCartItems(meta.cart_items);
            const hasAnyExclusive = cartItems.some((i) => i.license_type === 'exclusive');
            void runFulfillment({
              session,
              meta,
              purchaseId: existingPurchase.id,
              trackIds: cartItems.map((i) => i.track_id),
              lineItems: cartItems,
              hasAnyExclusive,
            });
            return NextResponse.json({ received: true });
          }

          // ── Parse cart items ──────────────────────────────────────────────
          // cart_items may use custom license UUIDs or legacy type strings.
          const rawCartItems = parseCartItems(meta.cart_items);

          // Collect custom license UUIDs so we can resolve is_exclusive from DB
          const customLicenseUUIDs = [...new Set(
            rawCartItems
              .map((i) => i.license_id)
              .filter((id) => UUID_RE.test(id)),
          )];

          const licenseById = new Map<string, any>();
          if (customLicenseUUIDs.length > 0) {
            const { data: licenseRows } = await admin
              .from('licenses')
              .select('id, name, is_exclusive, file_types, stems_included')
              .in('id', customLicenseUUIDs);
            for (const row of licenseRows ?? []) licenseById.set(row.id, row);
          }

          // Build fully-resolved line items with canonical license_type
          const resolvedLineItems = rawCartItems.map((i) => ({
            track_id: i.track_id,
            license_id: i.license_id,
            license_type: resolveTypeFromRaw(i.license_id ?? i.license_type ?? '', licenseById),
          }));

          const trackIds = resolvedLineItems.map((i) => i.track_id);

          // Legacy headline fields (backward compat for readers of top-level columns)
          const headlineLicenseType = resolvedLineItems[0]?.license_type ?? 'lease';
          const hasAnyExclusive = resolvedLineItems.some((i) => i.license_type === 'exclusive');

          // ── Upsert purchase row ────────────────────────────────────────────
          // stripe_session_id is UNIQUE — this is the layer-2 idempotency guard.
          const { data: upsertedRows, error: upsertErr } = await admin
            .from('license_purchases')
            .upsert(
              {
                seller_user_id: meta.seller_user_id || null,
                buyer_email: meta.buyer_email || session.customer_email || 'unknown@invalid',
                buyer_stripe_customer: session.customer || null,
                share_token: meta.share_token || null,
                track_ids: trackIds,
                line_items: resolvedLineItems,
                license_type: headlineLicenseType,
                amount_usd: (session.amount_total ?? 0) / 100,
                stripe_session_id: session.id,
                stripe_payment_intent: session.payment_intent || null,
                status: 'paid',
                download_unlocked: true,
                fulfillment_email_sent: false,
              },
              { onConflict: 'stripe_session_id' },
            )
            .select('id');

          if (upsertErr) throw upsertErr;

          const purchaseId = (upsertedRows as any[])?.[0]?.id;
          if (!purchaseId) {
            throw new Error('Failed to retrieve purchase ID after upsert');
          }

          // ── Return 200 immediately — Stripe won't retry if we respond quickly ──
          // Background tasks run asynchronously and do NOT block the response.
          void runFulfillment({
            session,
            meta,
            purchaseId,
            trackIds,
            lineItems: resolvedLineItems,
            hasAnyExclusive,
          });

          log.info('checkout.session.completed processed', {
            session_id: session.id,
            purchase_id: purchaseId,
            license_type: headlineLicenseType,
            items: resolvedLineItems.length,
            exclusive: hasAnyExclusive,
          });
        }
        break;
      }

      // ── charge.refunded / charge.dispute.created ───────────────────────────
      // Both events revoke download access. The purchase row is kept for audit.
      case 'charge.refunded':
      case 'charge.dispute.created': {
        const charge = event.data.object as any;
        const newStatus = event.type === 'charge.refunded' ? 'refunded' : 'disputed';

        const { error } = await admin
          .from('license_purchases')
          .update({ status: newStatus, download_unlocked: false })
          .eq('stripe_payment_intent', charge.payment_intent);

        if (error) {
          log.warn(`${newStatus} update failed`, { payment_intent: charge.payment_intent, error: errorMessage(error) });
        } else {
          log.info(`purchase marked ${newStatus}`, { payment_intent: charge.payment_intent });
        }

        // If refunding an exclusive, optionally re-list the track.
        // We do this on a best-effort basis — if the seller has already
        // manually relisted it, this is a no-op.
        if (event.type === 'charge.refunded') {
          try {
            const { data: purchase } = await admin
              .from('license_purchases')
              .select('track_ids, license_type, line_items')
              .eq('stripe_payment_intent', charge.payment_intent)
              .maybeSingle();

            if (purchase?.line_items) {
              const exclusiveTracks = (purchase.line_items as any[])
                .filter((li: any) => li.license_type === 'exclusive')
                .map((li: any) => li.track_id);
              if (exclusiveTracks.length > 0) {
                await admin
                  .from('tracks')
                  .update({ store_listed: true })
                  .in('id', exclusiveTracks);
                log.info('refunded exclusive tracks re-listed', { track_ids: exclusiveTracks });
              }
            }
          } catch (err) {
            log.warn('exclusive re-list on refund failed', { error: errorMessage(err) });
          }
        }
        break;
      }

      default:
        // Return 200 for all other events so Stripe stops retrying them.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    log.error('webhook handler errored', { type: event.type, event_id: event.id, error: errorMessage(err) });
    // Non-200 tells Stripe to retry. Only throw on genuine failures, not on
    // idempotency skips (those return early above with 200).
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
