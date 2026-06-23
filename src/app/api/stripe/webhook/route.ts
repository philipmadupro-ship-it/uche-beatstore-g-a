import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { getStripe } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { DEFAULT_TEMPLATE_MD, fillTemplate } from '@/lib/contracts/license-template';
import { renderContractPdf } from '@/lib/contracts/pdf';
import { uploadContractPdf } from '@/lib/storage/upload';
import {
  legacyLicenseFileTypes,
  normalizeLicenseFileTypes,
  parsePurchaseLineItem,
  type PurchaseLineItem,
} from '@/lib/store/license-entitlements';

const log = createLogger('stripe.webhook');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type AdminClient = ReturnType<typeof createServiceClient>;
type LicenseLookup = {
  is_exclusive?: boolean | null;
  file_types?: string[] | null;
  stems_included?: boolean | null;
};

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
 * ── Fulfillment sequencing ────────────────────────────────────────────────
 * Stripe receives 200 only after durable purchase/access state exists and
 * fulfillment has had a chance to send delivery. Optional notifications stay
 * best-effort so they cannot block a paid buyer.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCartItems(raw: string): Array<{ track_id: string; license_id: string; license_type: string }> {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i: unknown): i is { track_id: string; license_id: string; license_type: string } =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as { track_id?: unknown }).track_id === 'string',
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
  licenseById: Map<string, LicenseLookup>,
): 'lease' | 'exclusive' {
  if (UUID_RE.test(raw)) {
    const row = licenseById.get(raw);
    return row?.is_exclusive === true ? 'exclusive' : 'lease';
  }
  return raw === 'exclusive-rights' || raw === 'exclusive' ? 'exclusive' : 'lease';
}

function isDuplicateDbError(err: unknown) {
  const maybeErr = err as { code?: string; message?: string } | null;
  return (
    maybeErr?.code === '23505' ||
    maybeErr?.message?.includes('duplicate') ||
    maybeErr?.message?.includes('already exists')
  );
}

async function hasProcessedStripeEvent(admin: AdminClient, eventId: string) {
  const { data, error } = await admin
    .from('processed_stripe_events')
    .select('event_id')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function markStripeEventProcessed(admin: AdminClient, eventId: string) {
  const { error } = await admin
    .from('processed_stripe_events')
    .insert({ event_id: eventId })
    .select('event_id');

  if (error) {
    if (isDuplicateDbError(error)) return false;
    throw error;
  }

  return true;
}

async function incrementPromoUse(admin: AdminClient, promoCode: string | undefined, sessionId: string) {
  if (!promoCode) return;

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
        session_id: sessionId,
      });
    }
  } catch (err) {
    log.warn('promo increment threw', { code: promoCode, error: errorMessage(err) });
  }
}

// ── Background fulfillment ──────────────────────────────────────────────────

async function runFulfillment(params: {
  session: any;
  meta: Record<string, string>;
  purchaseId: string;
  trackIds: string[];
  lineItems: PurchaseLineItem[];
  hasAnyExclusive: boolean;
}) {
  const { session, meta, purchaseId, trackIds, lineItems, hasAnyExclusive } = params;
  const admin = createServiceClient();
  const APP_URL = getAppUrl();

  // 1. CRM — upsert buyer into the seller's contacts list, then log the
  // purchase to the contact's activity timeline (the buyer → contact link).
  if (meta.seller_user_id && meta.buyer_email) {
    try {
      const { data: existing } = await admin
        .from('contacts')
        .select('id')
        .eq('user_id', meta.seller_user_id)
        .eq('email', meta.buyer_email)
        .maybeSingle();

      let contactId = existing?.id as string | undefined;

      if (!existing) {
        const { data: inserted } = await admin.from('contacts').insert({
          user_id: meta.seller_user_id,
          name: session.customer_details?.name || 'Customer',
          email: meta.buyer_email,
          role: 'artist',
          label: 'buyer',
          notes: `Purchased via ${meta.source_surface === 'store' ? 'store' : 'share link'}`,
          buyer_pipeline_status: 'purchased',
        }).select('id').single();
        contactId = inserted?.id;
      } else {
        // Ensure pipeline status is updated even for returning buyers
        await admin
          .from('contacts')
          .update({ buyer_pipeline_status: 'purchased' })
          .eq('user_id', meta.seller_user_id)
          .eq('email', meta.buyer_email);
      }

      // Activity timeline entry. dedupe_key = stripe session id so retries
      // and the timeline's derived-purchase path don't double-log. Title is
      // built from track titles; non-fatal on any failure.
      if (contactId) {
        try {
          const amountUsd = session.amount_total != null ? Number(session.amount_total) / 100 : null;
          const lic = hasAnyExclusive ? 'Exclusive' : 'Lease';
          const { data: trackRows } = await admin
            .from('tracks')
            .select('id, title')
            .in('id', trackIds);
          const titles = (trackRows ?? []).map((t: any) => t.title).filter(Boolean);
          const what = titles.length === 0 ? 'a track'
            : titles.length === 1 ? titles[0]
            : `${titles[0]} + ${titles.length - 1} more`;
          const amtLabel = amountUsd != null
            ? ` — $${amountUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
            : '';
          await admin.from('contact_activity').insert({
            contact_id: contactId,
            user_id: meta.seller_user_id,
            kind: 'purchase',
            title: `Bought ${what}${amtLabel}`,
            body: `${lic} license`,
            metadata: {
              stripe_session_id: session.id,
              dedupe_key: session.id,
              track_ids: trackIds,
              amount_usd: amountUsd,
              purchase_id: purchaseId,
            },
          });
        } catch (err) {
          log.warn('activity purchase log failed', { error: errorMessage(err) });
        }
      }
    } catch (err) {
      log.warn('CRM upsert failed', { error: errorMessage(err) });
    }
  }

  // 2. Exclusivity lock — for any exclusive item, mark the track sold.
  // We keep store_listed = true so the storefront still renders the beat
  // with an "Exclusive Sold" badge (buy options hidden client-side) instead
  // of having it silently vanish. The producer can re-list by clearing the
  // flag; a refund clears it automatically (charge.refunded branch below).
  if (hasAnyExclusive) {
    const exclusiveTrackIds = lineItems
      .filter((li) => li.license_type === 'exclusive')
      .map((li) => li.track_id);

    if (exclusiveTrackIds.length > 0) {
      try {
        const { error } = await admin
          .from('tracks')
          .update({ exclusive_sold: true })
          .in('id', exclusiveTrackIds);
        if (error) {
          log.warn('exclusivity lock failed', { trackIds: exclusiveTrackIds, error: errorMessage(error) });
        } else {
          log.info('exclusive tracks marked sold', { trackIds: exclusiveTrackIds });
        }
      } catch (err) {
        log.warn('exclusivity lock threw', { error: errorMessage(err) });
      }
    }
  }

  // 2b. Stems-pending notice — exclusive purchase landed on a track with
  // no WAV and no ready stems. Flag the purchase row so the producer's
  // /sales dashboard can surface it, then email the producer so they
  // can upload before the buyer gets impatient. Checkout writes the
  // track ids into metadata.stems_pending_track_ids as CSV.
  const stemsPendingCsv = meta.stems_pending_track_ids ?? '';
  const stemsPendingIds = stemsPendingCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (stemsPendingIds.length > 0) {
    try {
      await admin
        .from('license_purchases')
        .update({ needs_stems_upload: true })
        .eq('id', purchaseId);
    } catch (err) {
      log.warn('needs_stems_upload flag set failed', { purchaseId, error: errorMessage(err) });
    }

    // Email the producer — needs RESEND + a contact_email on the
    // creator_profiles row OR the auth user's email. Look those up.
    if (process.env.RESEND_API_KEY && meta.seller_user_id) {
      try {
        // Pull contact_email first (preferred — buyer-facing producer
        // address), fall back to the auth user's primary email.
        const { data: prof } = await admin
          .from('creator_profiles')
          .select('contact_email, display_name')
          .eq('user_id', meta.seller_user_id)
          .maybeSingle();
        let producerEmail = (prof as any)?.contact_email as string | null | undefined;
        const producerName = (prof as any)?.display_name as string | null | undefined;
        if (!producerEmail) {
          const { data: userRes } = await admin.auth.admin.getUserById(meta.seller_user_id);
          producerEmail = userRes?.user?.email ?? null;
        }

        if (producerEmail) {
          // Pull titles for the affected tracks so the producer knows
          // exactly what needs uploading
          const { data: trackRows } = await admin
            .from('tracks')
            .select('id, title')
            .in('id', stemsPendingIds);
          const titles = (trackRows ?? []).map((t: any) => t.title || t.id);

          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: producerEmail,
            subject: `Exclusive sold — upload stems for ${titles.length} track${titles.length === 1 ? '' : 's'}`,
            html: `
              <div style="font-family: sans-serif; background: #090907; color: #F7EBDD; padding: 40px; border-radius: 20px; max-width: 560px;">
                <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #E7D7BE; margin: 0 0 20px;">
                  Action needed
                </h1>
                <p style="font-size: 15px; line-height: 1.7;">
                  ${producerName ? `Hi ${producerName}, ` : ''}a buyer just purchased an exclusive license, but the track${titles.length === 1 ? "" : "s"} below ${titles.length === 1 ? "doesn't" : "don't"} have a WAV or finished stems on file yet. Please upload them so the buyer can complete their download.
                </p>
                <div style="margin: 24px 0; padding: 16px; background: #171511; border-radius: 12px; border: 1px solid #2B2821; font-size: 12px; color: #D0C3AF; font-family: monospace; line-height: 1.8;">
                  ${titles.map((t: string) => `• ${t}`).join('<br/>')}
                </div>
                <p style="font-size: 13px; color: #D0C3AF;">
                  Buyer: ${meta.buyer_email ?? 'unknown'} · Amount: $${((session.amount_total ?? 0) / 100).toFixed(2)}
                </p>
                <div style="margin-top: 32px;">
                  <a href="${APP_URL}/library"
                     style="background: #E7D7BE; color: #090907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
                    Upload in Library
                  </a>
                </div>
                <p style="margin-top: 32px; font-size: 10px; color: #837B6D; text-transform: uppercase; letter-spacing: 0.25em;">
                  This purchase is also flagged in /sales with an "Awaiting stems" badge.
                </p>
              </div>
            `,
          });
          log.info('stems-pending producer email sent', {
            purchaseId,
            to: producerEmail,
            trackIds: stemsPendingIds,
          });
        } else {
          log.warn('stems-pending: no producer email on file', {
            purchaseId,
            seller_user_id: meta.seller_user_id,
          });
        }
      } catch (err) {
        log.warn('stems-pending producer email failed', { purchaseId, error: errorMessage(err) });
      }
    }
  }

  // 3. Generate the license-contract PDF (migration 057). Best-effort —
  // if it fails (R2 down, template malformed) we still send the
  // delivery email without an attachment so the buyer isn't blocked.
  let contractPdfUrl: string | null = null;
  let contractPdfBuffer: Buffer | null = null;
  try {
    // Pull template + producer info + track titles + buyer name
    const [{ data: prof }, { data: trackRows }] = await Promise.all([
      meta.seller_user_id
        ? admin
            .from('creator_profiles')
            .select('display_name, contact_email, license_template_md')
            .eq('user_id', meta.seller_user_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      trackIds.length
        ? admin.from('tracks').select('id, title').in('id', trackIds)
        : Promise.resolve({ data: [] }),
    ]);

    const titlesByTrack = new Map<string, string>(
      ((trackRows ?? []) as any[]).map((t) => [t.id, t.title as string]),
    );
    const orderedTitles = lineItems.map(
      (li) => titlesByTrack.get(li.track_id) ?? `Track ${li.track_id.slice(0, 8)}`,
    );
    const dominantType = hasAnyExclusive ? 'Exclusive' : 'Lease';
    const profAny = prof as Record<string, unknown> | null;
    const templateMd = ((profAny?.license_template_md as string | null | undefined) ?? '').trim()
      || DEFAULT_TEMPLATE_MD;

    const totalCentsForContract = Number(session.amount_total ?? 0);
    const priceLabel = `$${(totalCentsForContract / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const filled = fillTemplate(templateMd, {
      buyer_name: session.customer_details?.name || meta.buyer_email || 'Customer',
      buyer_email: meta.buyer_email || '',
      track_titles: orderedTitles.join(' · '),
      license_type: dominantType,
      purchase_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      purchase_id: purchaseId.slice(0, 8),
      producer_name: (profAny?.display_name as string | null | undefined) || 'Producer',
      producer_email: (profAny?.contact_email as string | null | undefined) || '',
      price: priceLabel,
    });

    contractPdfBuffer = await renderContractPdf(filled);
    const uploadedUrl = await uploadContractPdf(purchaseId, contractPdfBuffer);
    if (uploadedUrl) {
      contractPdfUrl = uploadedUrl;
      await admin
        .from('license_purchases')
        .update({ contract_pdf_url: uploadedUrl })
        .eq('id', purchaseId);
    }
    log.info('license contract pdf ready', { purchaseId, hasUrl: !!uploadedUrl });
  } catch (err) {
    log.warn('contract pdf generation failed', { purchaseId, error: errorMessage(err) });
  }

  // 4. Delivery email — guarded by fulfillment_email_sent flag to prevent duplicates
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

      const contractLine = contractPdfUrl
        ? `<p style="margin-top: 20px; font-size: 12px; color: #D0C3AF;">
             📜 Your signed-style <a href="${contractPdfUrl}" style="color: #E7D7BE; text-decoration: underline;">license agreement (PDF)</a> is attached to this email.
           </p>`
        : '';

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: meta.buyer_email,
        subject: `Your license${lineItems.length > 1 ? 's are' : ' is'} ready`,
        attachments: contractPdfBuffer
          ? [{
              filename: `license-${purchaseId.slice(0, 8)}.pdf`,
              content: contractPdfBuffer.toString('base64'),
            }]
          : undefined,
        html: `
          <div style="font-family: sans-serif; background: #090907; color: #F7EBDD; padding: 40px; border-radius: 20px; max-width: 560px;">
            <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #E7D7BE; margin: 0 0 20px;">
              Purchase complete
            </h1>
            <p style="font-size: 15px; line-height: 1.7; color: #F7EBDD;">
              Thanks for your purchase. Your license${lineItems.length > 1 ? 's are' : ' is'} now active and your files are ready to download.
            </p>
            <div style="margin: 24px 0; padding: 16px; background: #171511; border-radius: 12px; border: 1px solid #2B2821; font-size: 12px; color: #D0C3AF; font-family: monospace; line-height: 1.8;">
              ${itemSummaries.join('<br/>')}
              <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #2B2821;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#D0C3AF;">
                  <span>Subtotal</span><span>${fmt(subtotalCents)}</span>
                </div>
                ${promoLine}
                <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:bold;color:#F7EBDD;margin-top:8px;">
                  <span>Total paid</span><span>${fmt(totalCents)}</span>
                </div>
              </div>
            </div>
            <div style="margin-top: 36px;">
              <a href="${downloadUrl}"
                 style="background: #F7EBDD; color: #090907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
                Download your files
              </a>
            </div>
            ${contractLine}
            <p style="margin-top: 48px; font-size: 10px; color: #837B6D; text-transform: uppercase; letter-spacing: 0.5em;">
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
          <div style="font-family: sans-serif; background: #090907; color: #F7EBDD; padding: 40px; border-radius: 20px; max-width: 560px;">
            <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #E7D7BE; margin: 0 0 20px;">
              Project purchase complete
            </h1>
            <p style="font-size: 15px; line-height: 1.7; color: #F7EBDD;">
              Thanks for your purchase. You now have full access to all tracks in <strong>${projName}</strong>.
            </p>
            <div style="margin-top: 36px;">
              <a href="${accessUrl}"
                 style="background: #F7EBDD; color: #090907; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; display: inline-block;">
                Access your project
              </a>
            </div>
            <p style="margin-top: 48px; font-size: 10px; color: #837B6D; text-transform: uppercase; letter-spacing: 0.5em;">
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
        // Lookup first so a failed durable write never leaves the event marked
        // processed. A final insert after fulfillment handles racey duplicates.
        if (await hasProcessedStripeEvent(admin, event.id)) {
          log.info('duplicate event, skipping', { event_id: event.id });
          return NextResponse.json({ received: true, skipped: true });
        }

        // Mark any abandoned-cart row for this session as recovered so the
        // reminder cron never emails a buyer who actually completed (mig 071).
        void admin.from('abandoned_carts').update({ recovered: true }).eq('stripe_session_id', session.id)
          .then(({ error }) => { if (error) log.warn('abandoned-cart recover failed', { error: error.message }); });

        const purchaseKind = meta.purchase_kind ?? 'track_license';

        if (purchaseKind === 'project') {
          // ── Project storefront purchase ─────────────────────────────────
          const projectId = meta.project_id;
          if (!projectId) {
            log.warn('project purchase missing project_id in metadata', { session_id: session.id });
            await markStripeEventProcessed(admin, event.id);
            await incrementPromoUse(admin, meta.promo_code, session.id);
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
            await runProjectFulfillment({
              session,
              meta,
              accessId: existingAccess.id,
              accessToken: existingAccess.token,
              projectId,
            });
            await markStripeEventProcessed(admin, event.id);
            await incrementPromoUse(admin, meta.promo_code, session.id);
            return NextResponse.json({ received: true });
          }

          // Create delivery token row (token auto-generated by DB).
          // amount_usd is frozen here from session.amount_total so the
          // producer's later price changes don't rewrite this row's history.
          // Denormalised seller_user_id (mig 049) so /api/sales +
          // /api/analytics can scope by owner without joining through
          // projects. Falls back to looking up the project's user_id
          // when the metadata doesn't have it (older checkout sessions).
          let sellerForAccess: string | null = meta.seller_user_id || null;
          if (!sellerForAccess) {
            const { data: proj } = await admin
              .from('projects')
              .select('user_id')
              .eq('id', projectId)
              .maybeSingle();
            sellerForAccess = (proj as any)?.user_id ?? null;
          }

          const { data: createdAccess, error: accessInsertErr } = await admin
            .from('project_access_links')
            .insert({
              project_id: projectId,
              buyer_email: meta.buyer_email || session.customer_email || 'unknown@invalid',
              stripe_session_id: session.id,
              amount_usd: (session.amount_total ?? 0) / 100,
              seller_user_id: sellerForAccess,
            })
            .select('id, token')
            .single();

          if (accessInsertErr) throw accessInsertErr;

          const accessId = createdAccess.id;
          const accessToken = createdAccess.token;

          // Fulfillment (CRM + email with /store/projects/access/${token})
          await runProjectFulfillment({
            session,
            meta,
            accessId,
            accessToken,
            projectId,
          });
          await markStripeEventProcessed(admin, event.id);
          await incrementPromoUse(admin, meta.promo_code, session.id);

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
            .select('id, fulfillment_email_sent, line_items')
            .eq('stripe_session_id', session.id)
            .maybeSingle();

          if (existingPurchase) {
            // Purchase row already exists (e.g. a previous delivery that timed out
            // after DB write but before 200 response). Still run background tasks
            // in case they didn't complete.
            log.info('purchase row exists, re-running fulfillment', { session_id: session.id });
            const existingLineItems = (existingPurchase as { line_items?: unknown }).line_items;
            const storedLineItems: PurchaseLineItem[] = Array.isArray(existingLineItems)
              ? existingLineItems
                  .map(parsePurchaseLineItem)
                  .filter((item: PurchaseLineItem | null): item is PurchaseLineItem => item !== null)
              : [];
            const cartItems: PurchaseLineItem[] = storedLineItems.length > 0
              ? storedLineItems
              : parseCartItems(meta.cart_items).map((item) => {
                  const licenseType = item.license_type === 'exclusive' ? 'exclusive' : 'lease';
                  return {
                    ...item,
                    license_type: licenseType,
                    file_types: legacyLicenseFileTypes(licenseType),
                    stems_included: licenseType === 'exclusive',
                    is_exclusive: licenseType === 'exclusive',
                  } satisfies PurchaseLineItem;
                });
            const hasAnyExclusive = cartItems.some((i) => i.is_exclusive);
            await runFulfillment({
              session,
              meta,
              purchaseId: existingPurchase.id,
              trackIds: cartItems.map((i) => i.track_id),
              lineItems: cartItems,
              hasAnyExclusive,
            });
            await markStripeEventProcessed(admin, event.id);
            await incrementPromoUse(admin, meta.promo_code, session.id);
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

          const licenseById = new Map<string, LicenseLookup>();
          if (customLicenseUUIDs.length > 0) {
            const { data: licenseRows } = await admin
              .from('licenses')
              .select('id, name, is_exclusive, file_types, stems_included')
              .in('id', customLicenseUUIDs);
            for (const row of licenseRows ?? []) licenseById.set(row.id, row);
          }

          // Build fully-resolved line items with canonical license_type
          const resolvedLineItems: PurchaseLineItem[] = rawCartItems.map((i) => {
            const licenseType = resolveTypeFromRaw(i.license_id ?? i.license_type ?? '', licenseById);
            const customLicense = licenseById.get(i.license_id);
            const fileTypes = customLicense
              ? normalizeLicenseFileTypes(customLicense.file_types)
              : legacyLicenseFileTypes(licenseType);
            const stemsIncluded = customLicense
              ? customLicense.stems_included === true
              : licenseType === 'exclusive';

            return {
              track_id: i.track_id,
              license_id: i.license_id || licenseType,
              license_type: licenseType,
              file_types: fileTypes,
              stems_included: stemsIncluded,
              is_exclusive: customLicense
                ? customLicense.is_exclusive === true
                : licenseType === 'exclusive',
            };
          });

          const trackIds = resolvedLineItems.map((i) => i.track_id);

          // Legacy headline fields (backward compat for readers of top-level columns)
          const headlineLicenseType = resolvedLineItems[0]?.license_type ?? 'lease';
          const hasAnyExclusive = resolvedLineItems.some((i) => i.is_exclusive);

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

          await runFulfillment({
            session,
            meta,
            purchaseId,
            trackIds,
            lineItems: resolvedLineItems,
            hasAnyExclusive,
          });
          await markStripeEventProcessed(admin, event.id);
          await incrementPromoUse(admin, meta.promo_code, session.id);

          log.info('checkout.session.completed processed', {
            session_id: session.id,
            purchase_id: purchaseId,
            license_type: headlineLicenseType,
            items: resolvedLineItems.length,
            exclusive: hasAnyExclusive,
          });

          // ── Notification insert ──────────────────────────────────
          if (meta.seller_user_id) {
            try {
              const amountUsd = ((session.amount_total ?? 0) / 100).toFixed(2);
              const beatCount = resolvedLineItems.length;
              const beatLabel = beatCount === 1 ? '1 beat' : `${beatCount} beats`;
              await admin.from('notifications').insert({
                user_id: meta.seller_user_id,
                kind: 'purchase',
                title: `New sale — ${beatLabel} ($${amountUsd})`,
                body: `From ${meta.buyer_email || session.customer_email || 'a buyer'}`,
                data: {
                  session_id: session.id,
                  amount_usd: parseFloat(amountUsd),
                  buyer_email: meta.buyer_email || session.customer_email,
                },
              }).then(({ error: ne }) => {
                if (ne) log.warn('notification insert failed', { error: ne.message });
              });
            } catch (ne) {
              log.warn('notification insert threw', { error: errorMessage(ne) });
            }
          }
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
        // ── Notification for refund / dispute ───────────────────────
        try {
          const { data: purchaseForNotif } = await admin
            .from('license_purchases')
            .select('seller_user_id, amount_usd, buyer_email')
            .eq('stripe_payment_intent', charge.payment_intent)
            .maybeSingle();
          if ((purchaseForNotif as any)?.seller_user_id) {
            const kindLabel = event.type === 'charge.refunded' ? 'refund' : 'dispute';
            const amtLabel = `$${Number((purchaseForNotif as any).amount_usd ?? 0).toFixed(2)}`;
            await admin.from('notifications').insert({
              user_id: (purchaseForNotif as any).seller_user_id,
              kind: kindLabel,
              title: event.type === 'charge.refunded'
                ? `Refund issued — ${amtLabel}`
                : `Dispute opened — ${amtLabel}`,
              body: (purchaseForNotif as any).buyer_email ?? undefined,
              data: { payment_intent: charge.payment_intent, amount_usd: (purchaseForNotif as any).amount_usd },
            });
          }
        } catch (ne) {
          log.warn('notification insert failed on refund/dispute', { error: errorMessage(ne) });
        }

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
                  .update({ exclusive_sold: false, store_listed: true })
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
