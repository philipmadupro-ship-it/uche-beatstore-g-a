import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { z } from 'zod';
import { streamAudioSource } from '@/lib/audio/stream-source';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';
import { normalizeEmail } from '@/lib/contacts/email';

const log = createLogger('api.store.free-download');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FreeDownloadBody = z.object({
  email: z.string().email('Invalid email address'),
  track_id: z.string().uuid('Invalid track ID'),
  name: z.string().max(200).optional(),
});

/**
 * POST /api/store/free-download
 *
 * Captures visitor email before triggering a free download.
 * 1. Validates email + track
 * 2. Logs to store_free_downloads (if migration 037 is applied)
 * 3. Upserts a buyer contact in the CRM (migration 038)
 * 4. Returns { download_url } — client fetches and triggers save
 */
export async function POST(req: NextRequest) {
  try {
    if (!await rateLimitDurable(`freedl:${clientIp(req)}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = FreeDownloadBody.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid request';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { track_id, name } = parsed.data;
    // Canonical form — store_free_downloads.email and contacts.email are both
    // matched case-insensitively downstream (and the contacts unique index is
    // case-sensitive), so normalise before either write.
    const email = normalizeEmail(parsed.data.email);

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const admin = createServiceClient();

    const { data: track } = await admin
      .from('tracks')
      .select('id, title, audio_url, store_listed, free_download_enabled, user_id')
      .eq('id', track_id)
      .maybeSingle();

    if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    if (!track.store_listed) return NextResponse.json({ error: 'Track not listed' }, { status: 403 });
    if (!track.free_download_enabled) return NextResponse.json({ error: 'Free download not enabled' }, { status: 403 });
    if (!track.audio_url) return NextResponse.json({ error: 'Audio unavailable' }, { status: 404 });

    // Log the download (migration 037). Non-fatal — a missing lead record must
    // never block the visitor's download.
    //
    // NOTE the failure mode this used to hide: supabase-js RESOLVES with
    // `{ error }` rather than throwing, so the previous `try/catch` around this
    // call could never fire. The insert failing (e.g. migration 037 not applied)
    // was invisible because nothing inspected `.error` — the catch only looked
    // like it was handling it. Checking the result is what actually surfaces it.
    const { error: leadError } = await admin
      .from('store_free_downloads')
      .insert({ track_id, email });
    if (leadError) {
      log.warn('free download lead not recorded', {
        trackId: track_id,
        error: leadError.message,
        hint: 'apply migration 037_store_free_downloads if the table is missing',
      });
    }

    // Upsert the lead into the seller's CRM. Non-fatal — a CRM failure must
    // never block the visitor's download — but no longer SILENT.
    //
    // This upsert was inert until now, for three compounding reasons:
    //   1. onConflict: 'email' names a constraint that does not exist. The
    //      only unique index is contacts_user_email_uniq (user_id, email)
    //      (mig 096), so Postgres raised 42P10 on every call.
    //   2. No user_id was supplied, so even a successful insert produced a
    //      null-owner row — invisible under mig 097's owner-only RLS.
    //   3. supabase-js resolves with { error } rather than throwing (the same
    //      trap called out on the store_free_downloads insert above), so the
    //      try/catch could never fire and nothing inspected the result.
    // Net effect: free-download leads never reached the CRM at all.
    const sellerUserId = (track as { user_id?: string | null }).user_id;
    if (sellerUserId) {
      const contactName = name?.trim() || email.split('@')[0];
      const { error: contactError } = await admin.from('contacts').upsert(
        {
          user_id: sellerUserId,
          email,
          name: contactName,
          category: 'buyer',
          buyer_pipeline_status: 'new_lead',
          // Seed the visible stage too — /api/store/me's lead upsert already
          // does this, and a contact with no crm_status falls back to the
          // derived activity tone, which reads as nothing at all for a new lead.
          crm_status: 'prospect',
        },
        // ignoreDuplicates: a returning lead must not have the producer's
        // curated name/stage overwritten by an auto-generated one.
        { onConflict: 'user_id,email', ignoreDuplicates: true },
      );
      if (contactError) {
        log.warn('free download lead contact upsert failed', { email, error: contactError.message });
      }
    } else {
      log.warn('free download lead contact skipped — track has no owner', { trackId: track_id });
    }

    log.info('free download', { track_id, email });
    return NextResponse.json({ ok: true, download_url: `/api/store/free-download?track_id=${encodeURIComponent(track_id)}` });
  } catch (err) {
    log.error('POST free-download failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * GET /api/store/free-download?track_id=xxx
 *
 * No auth required — free downloads are public.
 *
 * Validates:
 *   1. track exists and is store_listed
 *   2. free_download_enabled = true on the track
 *
 * Then streams the file through this route so the raw R2 URL is never exposed.
 *
 * Future: insert a record into a download_plays table for analytics.
 */
export async function GET(req: NextRequest) {
  const trackId = new URL(req.url).searchParams.get('track_id');
  if (!trackId) {
    return NextResponse.json({ error: 'track_id required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const admin = createServiceClient();

    const { data: track } = await admin
      .from('tracks')
      .select('id, title, audio_url, store_listed, free_download_enabled')
      .eq('id', trackId)
      .maybeSingle();

    if (!track) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    }
    if (!track.store_listed) {
      return NextResponse.json({ error: 'Track is not listed' }, { status: 403 });
    }
    if (!track.free_download_enabled) {
      return NextResponse.json({ error: 'Free download not enabled for this track' }, { status: 403 });
    }
    if (!track.audio_url) {
      return NextResponse.json({ error: 'Audio not available' }, { status: 404 });
    }

    const extMatch = (track.audio_url as string).match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
    const ext = (extMatch?.[1] ?? 'mp3').toLowerCase();
    const filename = `${track.title || 'track'}.${ext}`;
    return streamAudioSource(req, track.audio_url as string, filename);
  } catch (err) {
    log.error('free-download failed', { trackId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
