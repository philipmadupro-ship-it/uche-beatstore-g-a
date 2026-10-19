import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isProjectAccessActive } from '@/lib/store/project-access';
import { purchaseAccess } from '@/lib/store/purchase-access';
import { bufferDownloadResponse, streamAudioSource } from '@/lib/audio/stream-source';
import { canDeriveMp3 } from '@/lib/audio/mp3-deliverable';
import { ensureTrackMp3 } from '@/lib/audio/mp3-deliverable.server';
import { alertMp3Unavailable } from '@/lib/store/mp3-alert';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import {
  recordDownload,
  shouldLogGrant,
  type DownloadDenial,
} from '@/lib/store/download-audit';
import {
  canDownloadFormat,
  parsePurchaseLineItem,
  type PurchaseLineItem,
} from '@/lib/store/license-entitlements';

const log = createLogger('api.store.download-file');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The first MP3 request for a WAV-mastered track reads the master and runs
// ffmpeg over it (seconds for a normal beat); later requests stream the stored
// derivative. Room for a long master.
export const maxDuration = 120;

/**
 * GET /api/store/download-file?session_id=cs_xxx&track_id=yyy
 *
 * Per-file download gate for the /store/download portal.
 * Validates the session_id covers this track, then streams the file directly
 * so the raw storage URL never appears in JSON, DOM, or redirect Location.
 *
 * Security model:
 *   - session_id is a Stripe cs_xxx (not guessable)
 *   - We confirm the purchase row still grants access (not refunded or
 *     disputed, not held for review) — see lib/store/purchase-access
 *   - We confirm track_id is in the purchase's track_ids array
 *   - We never expose the raw R2/storage URL in the redirect
 *   - Per-IP rate limit before any lookup (429), so the endpoint cannot be
 *     hammered or used to probe for session ids
 *   - Every grant and every refusal on a known purchase is written to the
 *     audit log (lib/store/download-audit.ts)
 */

/** Requests per IP per minute. A buyer saving a whole bundle clicks a few dozen
 *  files (each is a pre-check plus the download); this is well above that and
 *  far below a scraper. */
const DOWNLOADS_PER_MINUTE = 240;
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  const trackId = searchParams.get('track_id');
  const format = searchParams.get('format') || 'mp3';

  if (!sessionId || !trackId) {
    return NextResponse.json({ error: 'session_id and track_id required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const ip = clientIp(req);
  if (!(await rateLimitDurable(`dl:${ip}`, DOWNLOADS_PER_MINUTE, 60_000))) {
    return NextResponse.json(
      { error: 'Too many download requests. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  try {
    const admin = createServiceClient();

    const { data: purchase, error: purchaseError } = await admin
      .from('license_purchases')
      .select('id, seller_user_id, download_unlocked, needs_refund_review, license_type, track_ids, line_items')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();
    // A failed lookup is not "no such purchase": falling through would answer
    // 404 for a paid buyer on a transient error and hide a broken query.
    if (purchaseError) throw purchaseError;

    // Filled in once the purchase is known; unknown sessions are not logged
    // (no seller to attribute them to, and a flood of guesses is not an audit).
    let ctx: { kind: 'track_license' | 'project'; id: string | null; seller: string | null } | null = null;
    const audit = (outcome: 'granted' | 'denied', reason?: DownloadDenial) =>
      ctx
        ? recordDownload(admin, {
            sellerUserId: ctx.seller, trackId, purchaseKind: ctx.kind, purchaseId: ctx.id,
            format, outcome, reason, ip,
          })
        : Promise.resolve();

    let entitlement: PurchaseLineItem | null = null;
    if (purchase) {
      ctx = { kind: 'track_license', id: purchase.id ?? null, seller: purchase.seller_user_id ?? null };
      const access = purchaseAccess(purchase);
      if (!access.allowed) {
        await audit('denied', access.reason);
        return NextResponse.json({ error: access.message }, { status: 403 });
      }
      if (!Array.isArray(purchase.track_ids) || !purchase.track_ids.includes(trackId)) {
        await audit('denied', 'track-not-in-purchase');
        return NextResponse.json({ error: 'Track not in this purchase' }, { status: 403 });
      }
      const lineItem = Array.isArray(purchase.line_items)
        ? purchase.line_items
            .map(parsePurchaseLineItem)
            .find((item: PurchaseLineItem | null): item is PurchaseLineItem => item?.track_id === trackId)
        : null;
      entitlement = lineItem ?? null;
      if (!entitlement) {
        const legacyType = purchase.license_type === 'exclusive' ? 'exclusive' : 'lease';
        entitlement = parsePurchaseLineItem({
          track_id: trackId,
          license_id: legacyType,
          license_type: legacyType,
        });
      }
    } else {
      const { data: access } = await admin
        .from('project_access_links')
        .select('id, project_id, expires_at, seller_user_id')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();
      if (!access) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
      }
      ctx = { kind: 'project', id: access.id ?? null, seller: access.seller_user_id ?? null };
      if (!isProjectAccessActive(access)) {
        await audit('denied', 'expired');
        return NextResponse.json({ error: 'Download access revoked (refunded, disputed or expired)' }, { status: 403 });
      }
      const { data: belongs } = await admin
        .from('project_tracks')
        .select('track_id')
        .eq('project_id', access.project_id)
        .eq('track_id', trackId)
        .maybeSingle();
      if (!belongs) {
        await audit('denied', 'track-not-in-purchase');
        return NextResponse.json({ error: 'Track not in this purchase' }, { status: 403 });
      }
      entitlement = {
        track_id: trackId,
        license_id: 'project',
        license_type: 'exclusive',
        file_types: ['MP3', 'WAV', 'STEMS'],
        stems_included: true,
        is_exclusive: true,
      };
    }

    if (!entitlement || !canDownloadFormat(entitlement, format)) {
      await audit('denied', 'format-not-permitted');
      return NextResponse.json({ error: 'File download not permitted by this license' }, { status: 403 });
    }

    const { data: track } = await admin
      .from('tracks')
      .select('audio_url, wav_url, title')
      .eq('id', trackId)
      .maybeSingle();

    let source: string | null = null;
    let derivedBytes: Buffer | null = null;
    let ext = 'mp3';
    if (format === 'wav') {
      const mainAudioIsWav = /\.wav(?:\?|$)/i.test(track?.audio_url ?? '');
      source = track?.wav_url || (mainAudioIsWav ? track?.audio_url : null) || null;
      ext = 'wav';
    } else if (['vocals', 'drums', 'bass', 'other'].includes(format)) {
      const column = `${format}_url`;
      const { data: stem } = await admin
        .from('stems')
        .select(`status, ${column}`)
        .eq('track_id', trackId)
        .eq('status', 'done')
        .maybeSingle();
      const stemValue = (stem as Record<string, unknown> | null)?.[column];
      source = typeof stemValue === 'string' ? stemValue : null;
      ext = 'wav';
    } else if (format === 'mp3' && canDeriveMp3(track?.audio_url)) {
      // The tier promises an MP3 and the master is not one (usually a WAV).
      // Make it from the master — never hand the master over in its place.
      const mp3 = await ensureTrackMp3({ id: trackId, audio_url: track?.audio_url });
      if (!mp3) {
        await audit('denied', 'file-missing');
        await alertMp3Unavailable(admin as unknown as Parameters<typeof alertMp3Unavailable>[0], { sellerUserId: ctx?.seller ?? null, trackId, title: track?.title ?? null });
        return NextResponse.json(
          { error: 'Your MP3 is still being prepared. Try again in a minute — the producer has been told.' },
          { status: 503, headers: { 'Retry-After': '60' } },
        );
      }
      ext = 'mp3';
      if (mp3.kind === 'ref') source = mp3.ref;
      else derivedBytes = mp3.buffer;
    } else {
      source = track?.audio_url || null;
      const extMatch = source?.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
      ext = (extMatch?.[1] ?? 'mp3').toLowerCase();
    }

    if (!source && !derivedBytes) {
      await audit('denied', 'file-missing');
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (!canDownloadFormat(entitlement, ext)) {
      await audit('denied', 'format-not-permitted');
      return NextResponse.json({ error: 'Stored file is not permitted by this license' }, { status: 403 });
    }
    const suffix = ['vocals', 'drums', 'bass', 'other'].includes(format) ? `_${format}` : '';
    const filename = `${track?.title || 'track'}${suffix}.${ext}`;
    if (shouldLogGrant(req.headers.get('range'), req.headers.has('x-download-probe'))) {
      await audit('granted');
    }
    if (derivedBytes) return bufferDownloadResponse(derivedBytes, filename, 'audio/mpeg');
    return streamAudioSource(req, source!, filename);
  } catch (err) {
    log.error('download-file failed', { sessionId, trackId, error: errorMessage(err) });
    // Public route: log the detail, never return it (DB/storage internals).
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
