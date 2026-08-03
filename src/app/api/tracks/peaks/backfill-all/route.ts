import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { readStoredObject } from '@/lib/storage/upload';
import { buildAndUploadSidecars } from '@/lib/audio/sidecars';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.peaks.backfill-all');
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/tracks/peaks/backfill-all
 *
 * Owner-only batch backfill — re-runs the per-track peaks extractor
 * for owned tracks that don't have a peaks_url yet. Used when
 * the producer wants accurate waveforms on tracks uploaded before
 * the peaks pipeline existed (or whose extraction silently failed).
 * Pass ?store_listed=1 to limit the run to buyer-facing beats.
 *
 * Synchronous on purpose — single-producer storefront usually has
 * ≤50 tracks, well under the 300s function limit. Returns a per-track
 * summary so the caller can show what worked.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;
  const listedOnly = req.nextUrl.searchParams.get('store_listed') === '1';

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  let query = admin
    .from('tracks')
    .select('id, title, audio_url, peaks_url, bands_url')
    .eq('user_id', userId);
  if (listedOnly) query = query.eq('store_listed', true);

  // Anything MISSING EITHER sidecar, not just tracks with no peaks.
  //
  // The filter used to be `.is('peaks_url', null)`, which was correct when
  // peaks were the only sidecar — but it would now skip the entire existing
  // catalogue, since those tracks all have peaks and none have bands. They are
  // exactly the tracks that still force every store visitor to analyse audio
  // in their own browser.
  const { data: tracks, error } = await query
    .or('peaks_url.is.null,bands_url.is.null')
    .not('audio_url', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targets = (tracks ?? []) as Array<{ id: string; title: string; audio_url: string }>;
  const results: Array<{ id: string; title: string; ok: boolean; error?: string }> = [];

  for (const t of targets) {
    try {
      const buf = await readStoredObject(t.audio_url);
      const { peaksUrl, bandsUrl, undecodable } = await buildAndUploadSidecars(buf, t.audio_url);
      if (undecodable) throw new Error('decoder returned null');
      if (!peaksUrl) throw new Error('sidecar upload failed');
      await admin.from('tracks').update({
        peaks_url: peaksUrl,
        ...(bandsUrl ? { bands_url: bandsUrl } : {}),
      }).eq('id', t.id);
      results.push({ id: t.id, title: t.title, ok: true });
    } catch (err) {
      const msg = errorMessage(err);
      log.warn('peaks backfill failed for track', { id: t.id, error: msg });
      results.push({ id: t.id, title: t.title, ok: false, error: msg });
    }
  }

  const summary = {
    scope: listedOnly ? 'store_listed' : 'all',
    total_needed: targets.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  log.info('peaks batch backfill complete', { user_id: userId, ...summary });
  return NextResponse.json(summary);
}
