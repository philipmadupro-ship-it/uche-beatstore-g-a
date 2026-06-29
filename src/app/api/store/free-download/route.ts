import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger, maskEmail } from '@/lib/log';
import { z } from 'zod';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

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
    const { email, track_id, name } = parsed.data;

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const admin = createServiceClient();

    const { data: track } = await admin
      .from('tracks')
      .select('id, title, audio_url, store_listed, free_download_enabled')
      .eq('id', track_id)
      .maybeSingle();

    if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    if (!track.store_listed) return NextResponse.json({ error: 'Track not listed' }, { status: 403 });
    if (!track.free_download_enabled) return NextResponse.json({ error: 'Free download not enabled' }, { status: 403 });
    if (!track.audio_url) return NextResponse.json({ error: 'Audio unavailable' }, { status: 404 });

    // Log the download (migration 037 — non-fatal if table doesn't exist yet)
    try {
      await admin.from('store_free_downloads').insert({ track_id, email });
    } catch {
      // migration not yet applied — skip
    }

    // Upsert buyer contact (migration 038 — non-fatal if column doesn't exist)
    try {
      const contactName = name?.trim() || email.split('@')[0];
      await admin
        .from('contacts')
        .upsert(
          {
            email,
            name: contactName,
            category: 'buyer',
            buyer_pipeline_status: 'new_lead',
          },
          { onConflict: 'email', ignoreDuplicates: false },
        );
    } catch {
      // non-fatal
    }

    // Build the proxied download URL (same as the GET path)
    const extMatch = (track.audio_url as string).match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
    const ext = (extMatch?.[1] ?? 'mp3').toLowerCase();
    const filename = `${track.title || 'track'}.${ext}`;
    const downloadUrl = `/api/audio?src=${encodeURIComponent(track.audio_url)}&download=1&filename=${encodeURIComponent(filename)}`;

    log.info('free download', { track_id, email: maskEmail(email) });
    return NextResponse.json({ ok: true, download_url: downloadUrl });
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
 * Then 302-redirects to /api/audio?src=...&download=1 so the browser
 * triggers a file save. The raw R2 URL is never exposed.
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
    const proxied = `/api/audio?src=${encodeURIComponent(track.audio_url)}&download=1&filename=${encodeURIComponent(filename)}`;

    return NextResponse.redirect(new URL(proxied, req.url), 302);
  } catch (err) {
    log.error('free-download failed', { trackId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
