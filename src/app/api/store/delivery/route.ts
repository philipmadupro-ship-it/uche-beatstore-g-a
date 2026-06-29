import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { getAppUrl } from '@/lib/env';
import { getPresignedUrl, r2KeyFromUrl } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';

const log = createLogger('api.store.delivery');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PurchaseRow = {
  id: string;
  buyer_email: string;
  amount_usd: number | string | null;
  created_at: string;
  status: string;
  download_unlocked: boolean;
  track_ids?: unknown;
  line_items?: unknown;
};

type ProjectAccessRow = {
  id: string;
  project_id: string;
  buyer_email: string;
  amount_usd?: number | string | null;
  created_at: string;
  stripe_session_id: string;
};

type ProjectTrackRow = { track_id: string };

type DeliveryLineItem = {
  track_id: string;
  license_type: string;
};

type DeliveryTrackRow = {
  id: string;
  title?: string | null;
  type?: string | null;
  cover_url?: string | null;
  audio_url?: string | null;
  wav_url?: string | null;
  peaks_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  stems_status?: string | null;
};

type StemRow = {
  track_id: string;
  status?: string | null;
  vocals_url?: string | null;
  drums_url?: string | null;
  bass_url?: string | null;
  other_url?: string | null;
};

// The bare `?session_id=` link is a post-purchase convenience for the buyer
// who just paid — not permanent access. After this window it stops working and
// the durable path is the account (magic link at /store/orders → /store/account).
// This bounds how long a leaked session link keeps working. Tunable.
const DELIVERY_LINK_TTL_DAYS = 14;

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
    let projectAccess: ProjectAccessRow | null = null;
    if (!purchase) {
      // Check for project storefront purchase
      const { data: access } = await admin
        .from('project_access_links')
        .select('id, project_id, buyer_email, amount_usd, created_at, stripe_session_id')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();
      if (access) {
        isProjectPurchase = true;
        projectAccess = access as ProjectAccessRow;
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

    // Time-box the bare session link — after the window, downloads live only in
    // the buyer's account.
    const createdAt = (isProjectPurchase ? projectAccess?.created_at : purchase?.created_at) ?? null;
    if (createdAt) {
      const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
      if (ageDays > DELIVERY_LINK_TTL_DAYS) {
        return NextResponse.json(
          {
            error: 'link_expired',
            message: 'This download link has expired. Sign in to your account to re-download.',
          },
          { status: 410 },
        );
      }
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
      trackIds = ((junctions ?? []) as ProjectTrackRow[]).map((j) => j.track_id);
      // treat as exclusive for stems inclusion
      lineItems = trackIds.map((tid) => ({ track_id: tid, license_type: 'exclusive' }));
    } else if (purchase) {
      const purchaseRow = purchase as PurchaseRow;
      trackIds = Array.isArray(purchaseRow.track_ids) ? purchaseRow.track_ids.filter((id): id is string => typeof id === 'string') : [];
      lineItems = Array.isArray(purchaseRow.line_items)
        ? purchaseRow.line_items.filter((item): item is DeliveryLineItem =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { track_id?: unknown }).track_id === 'string')
        : [];
    }

    let tracks: DeliveryTrackRow[] = [];
    if (trackIds.length > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select('id, title, type, cover_url, audio_url, wav_url, peaks_url, duration_seconds, bpm, key, scale, stems_status')
        .in('id', trackIds);
      tracks = (trackRows ?? []) as DeliveryTrackRow[];
    }

    // ── WAV urls (migration 039, non-fatal if column absent) ──────────────
    // wav_url is already in the select above. No extra query needed.

    // ── Stems (done rows for these tracks) ────────────────────────────────
    const stemsByTrack: Record<string, StemRow> = {};
    if (trackIds.length > 0) {
      try {
        const { data: stemRows } = await admin
          .from('stems')
          .select('track_id, status, vocals_url, drums_url, bass_url, other_url')
          .in('track_id', trackIds)
          .eq('status', 'done');
        for (const r of (stemRows ?? []) as StemRow[]) {
          stemsByTrack[r.track_id] = r;
        }
      } catch {
        // stems table may not exist — non-fatal
      }
    }

    // ── Build per-track downloads array ────────────────────────────────────
    // Deliverables are minted as short-TTL R2 presigned URLs so a leaked link
    // dies within the hour, instead of the old permanent unauthenticated
    // /api/audio proxy link. Falls back to the proxy for local/dev paths or
    // legacy non-R2 URLs.
    async function deliverUrl(rawUrl: string, filename: string): Promise<string> {
      const key = r2KeyFromUrl(rawUrl);
      if (key) {
        try {
          return await getPresignedUrl(key, { downloadFilename: filename, expiresIn: 3600 });
        } catch (err) {
          log.warn('presign failed, falling back to proxy', { error: errorMessage(err) });
        }
      }
      return `${APP_URL}/api/audio?src=${encodeURIComponent(rawUrl)}&download=1&filename=${encodeURIComponent(filename)}`;
    }

    const tracksWithDownloads = await Promise.all(tracks.map(async (t) => {
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
          proxied_url: await deliverUrl(t.audio_url, `${titleSafe}.${audioExt}`),
        });
      }

      // Separate WAV upload (migration 039) — available for all license types
      // if the producer uploaded it
      const wavUrl = t.wav_url as string | null;
      if (wavUrl && audioExt !== 'wav') {
        downloads.push({
          format: 'wav',
          label: 'WAV (high quality)',
          proxied_url: await deliverUrl(wavUrl, `${titleSafe}.wav`),
        });
      }

      // Stems — only for exclusive licensees, and only when stems job is done
      if (licenseType === 'exclusive') {
        const stem = stemsByTrack[t.id];
        if (stem) {
          const stemMap: Array<{ format: string; label: string; urlKey: keyof StemRow }> = [
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
                proxied_url: await deliverUrl(url, `${titleSafe}_${format}.wav`),
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
    }));

    const purchaseForClient = isProjectPurchase && projectAccess
      ? {
          id: projectAccess.id,
          buyer_email: projectAccess.buyer_email,
          amount_usd: Number(projectAccess.amount_usd ?? 0),
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
    return publicError(err);
  }
}
