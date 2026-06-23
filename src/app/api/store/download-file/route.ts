import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { streamAudioSource } from '@/lib/audio/stream-source';
import {
  canDownloadFormat,
  parsePurchaseLineItem,
  type PurchaseLineItem,
} from '@/lib/store/license-entitlements';

const log = createLogger('api.store.download-file');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/download-file?session_id=cs_xxx&track_id=yyy
 *
 * Per-file download gate for the /store/download portal.
 * Validates the session_id covers this track, then streams the file directly
 * so the raw storage URL never appears in JSON, DOM, or redirect Location.
 *
 * Security model:
 *   - session_id is a Stripe cs_xxx (not guessable)
 *   - We confirm download_unlocked=true on the purchase row
 *   - We confirm track_id is in the purchase's track_ids array
 *   - We never expose the raw R2/storage URL in the redirect
 */
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

  try {
    const admin = createServiceClient();

    const { data: purchase } = await admin
      .from('license_purchases')
      .select('download_unlocked, license_type, track_ids, line_items')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();

    let entitlement: PurchaseLineItem | null = null;
    if (purchase) {
      if (!purchase.download_unlocked) {
        return NextResponse.json({ error: 'Download access revoked' }, { status: 403 });
      }
      if (!Array.isArray(purchase.track_ids) || !purchase.track_ids.includes(trackId)) {
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
        .select('project_id')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();
      if (!access) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
      }
      const { data: belongs } = await admin
        .from('project_tracks')
        .select('track_id')
        .eq('project_id', access.project_id)
        .eq('track_id', trackId)
        .maybeSingle();
      if (!belongs) {
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
      return NextResponse.json({ error: 'File download not permitted by this license' }, { status: 403 });
    }

    const { data: track } = await admin
      .from('tracks')
      .select('audio_url, wav_url, title')
      .eq('id', trackId)
      .maybeSingle();

    let source: string | null = null;
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
    } else {
      source = track?.audio_url || null;
      const extMatch = source?.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
      ext = (extMatch?.[1] ?? 'mp3').toLowerCase();
    }

    if (!source) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (!canDownloadFormat(entitlement, ext)) {
      return NextResponse.json({ error: 'Stored file is not permitted by this license' }, { status: 403 });
    }
    const suffix = ['vocals', 'drums', 'bass', 'other'].includes(format) ? `_${format}` : '';
    const filename = `${track?.title || 'track'}${suffix}.${ext}`;
    return streamAudioSource(req, source, filename);
  } catch (err) {
    log.error('download-file failed', { sessionId, trackId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
