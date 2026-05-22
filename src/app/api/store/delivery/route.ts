import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.store.delivery');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/delivery?session_id=cs_xxx
 *
 * Public-ish endpoint (no auth, but requires a valid Stripe session_id
 * that matches a license_purchases row with download_unlocked=true).
 *
 * Returns everything the /store/download portal needs to render:
 *   {
 *     purchase: { id, buyer_email, amount_usd, created_at, status },
 *     tracks: [
 *       {
 *         ...track fields...,
 *         license_type: 'lease' | 'exclusive',
 *         downloads: [
 *           { format: 'mp3', label: 'MP3', proxied_url: '/api/audio?...' },
 *           { format: 'wav', label: 'WAV', proxied_url: '...' },      // if wav_url uploaded
 *           { format: 'vocals', label: 'Vocals Stem', proxied_url: '...' }, // if stems done + exclusive
 *           ...
 *         ]
 *       }
 *     ]
 *   }
 *
 * Download URLs are pre-computed as /api/audio proxy URLs (same-origin,
 * Content-Disposition: attachment) so the client can trigger them with a
 * plain <a href download> — no server-side redirect chain that confuses
 * browsers into "opening a page" instead of saving.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const admin = createServiceClient();
    const APP_URL = getAppUrl();

    // ── Validate purchase ──────────────────────────────────────────────────
    const { data: purchase, error: pErr } = await admin
      .from('license_purchases')
      .select('id, buyer_email, amount_usd, created_at, status, download_unlocked, track_ids, line_items')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();

    if (pErr) throw pErr;

    let isProjectPurchase = false;
    let projectAccess: any = null;
    if (!purchase) {
      // Check for project storefront purchase
      const { data: access } = await admin
        .from('project_access_links')
        .select('id, project_id, buyer_email, created_at, stripe_session_id')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();
      if (access) {
        isProjectPurchase = true;
        projectAccess = access;
      } else {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
      }
    }
    if (!isProjectPurchase && !purchase?.download_unlocked) {
      return NextResponse.json(
        { error: 'Download access revoked (refunded or disputed)' },
        { status: 403 },
      );
    }

    let trackIds: string[] = [];
    let lineItems: Array<{ track_id: string; license_type: string }> = [];
    if (isProjectPurchase && projectAccess) {
      // Load all tracks belonging to the purchased project; grant full access (stems included)
      const { data: junctions } = await admin
        .from('project_tracks')
        .select('track_id')
        .eq('project_id', projectAccess.project_id)
        .order('position', { ascending: true });
      trackIds = (junctions ?? []).map((j: any) => j.track_id);
      // treat as exclusive for stems inclusion
      lineItems = trackIds.map((tid) => ({ track_id: tid, license_type: 'exclusive' }));
    } else if (purchase) {
      trackIds = Array.isArray(purchase.track_ids) ? purchase.track_ids : [];
      lineItems = Array.isArray(purchase.line_items) ? purchase.line_items : [];
    }

    let tracks: any[] = [];
    if (trackIds.length > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select('id, title, type, cover_url, audio_url, wav_url, peaks_url, duration_seconds, bpm, key, scale, stems_status')
        .in('id', trackIds);
      tracks = trackRows ?? [];
    }

    // ── WAV urls (migration 039, non-fatal if column absent) ──────────────
    // wav_url is already in the select above. No extra query needed.

    // ── Stems (done rows for these tracks) ────────────────────────────────
    let stemsByTrack: Record<string, any> = {};
    if (trackIds.length > 0) {
      try {
        const { data: stemRows } = await admin
          .from('stems')
          .select('track_id, status, vocals_url, drums_url, bass_url, other_url')
          .in('track_id', trackIds)
          .eq('status', 'done');
        for (const r of (stemRows ?? []) as any[]) {
          stemsByTrack[r.track_id] = r;
        }
      } catch {
        // stems table may not exist — non-fatal
      }
    }

    // ── Build per-track downloads array ────────────────────────────────────
    function proxied(rawUrl: string, filename: string): string {
      return `${APP_URL}/api/audio?src=${encodeURIComponent(rawUrl)}&download=1&filename=${encodeURIComponent(filename)}`;
    }

    const tracksWithDownloads = tracks.map((t) => {
      const item = lineItems.find((li) => li.track_id === t.id);
      const licenseType: 'lease' | 'exclusive' =
        (item?.license_type === 'exclusive' ? 'exclusive' : 'lease');

      const titleSafe = (t.title || 'track').replace(/[^\w\s\-]/g, '_');
      const audioExt = (
        (t.audio_url as string | null)?.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i)?.[1] ?? 'mp3'
      ).toLowerCase();

      const downloads: Array<{ format: string; label: string; proxied_url: string }> = [];

      // MP3 / main audio — always included
      if (t.audio_url) {
        downloads.push({
          format: audioExt === 'wav' ? 'wav-main' : 'mp3',
          label: audioExt === 'wav' ? 'WAV (main)' : 'MP3',
          proxied_url: proxied(t.audio_url, `${titleSafe}.${audioExt}`),
        });
      }

      // Separate WAV upload (migration 039) — available for all license types
      // if the producer uploaded it
      const wavUrl = t.wav_url as string | null;
      if (wavUrl && audioExt !== 'wav') {
        downloads.push({
          format: 'wav',
          label: 'WAV (high quality)',
          proxied_url: proxied(wavUrl, `${titleSafe}.wav`),
        });
      }

      // Stems — only for exclusive licensees, and only when stems job is done
      if (licenseType === 'exclusive') {
        const stem = stemsByTrack[t.id];
        if (stem) {
          const stemMap = [
            { format: 'vocals', label: 'Vocals Stem', urlKey: 'vocals_url' },
            { format: 'drums',  label: 'Drums Stem',  urlKey: 'drums_url' },
            { format: 'bass',   label: 'Bass Stem',   urlKey: 'bass_url' },
            { format: 'other',  label: 'Other Stem',  urlKey: 'other_url' },
          ];
          for (const { format, label, urlKey } of stemMap) {
            const url = stem[urlKey] as string | null;
            if (url) {
              downloads.push({
                format,
                label,
                proxied_url: proxied(url, `${titleSafe}_${format}.wav`),
              });
            }
          }
        }
      }

      return {
        ...t,
        // remove raw R2 URLs from client response (they're embedded inside proxied_url already)
        audio_url: undefined,
        wav_url: undefined,
        license_type: licenseType,
        file_types: downloads.map((d) => d.label), // backward compat
        downloads,
      };
    });

    const purchaseForClient = isProjectPurchase && projectAccess
      ? {
          id: projectAccess.id,
          buyer_email: projectAccess.buyer_email,
          amount_usd: 0, // will be shown in email / Stripe receipt
          created_at: projectAccess.created_at,
          status: 'paid',
        }
      : {
          id: purchase!.id,
          buyer_email: purchase!.buyer_email,
          amount_usd: purchase!.amount_usd,
          created_at: purchase!.created_at,
          status: purchase!.status,
        };

    return NextResponse.json({
      purchase: purchaseForClient,
      tracks: tracksWithDownloads,
    });
  } catch (err) {
    log.error('delivery lookup failed', { sessionId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
