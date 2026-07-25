import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { extractPeaks } from '@/lib/audio/peaks';
import { readStoredObject, uploadPeaksSidecar } from '@/lib/storage/upload';
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
    .select('id, title, audio_url, peaks_url')
    .eq('user_id', userId);
  if (listedOnly) query = query.eq('store_listed', true);

  const { data: tracks, error } = await query
    .is('peaks_url', null)
    .not('audio_url', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targets = (tracks ?? []) as Array<{ id: string; title: string; audio_url: string }>;
  const results: Array<{ id: string; title: string; ok: boolean; error?: string }> = [];

  for (const t of targets) {
    try {
      const buf = await readStoredObject(t.audio_url);
      const peaks = await extractPeaks(buf);
      if (!peaks) throw new Error('decoder returned null');
      const peaksUrl = await uploadPeaksSidecar(t.audio_url, JSON.stringify(peaks));
      if (!peaksUrl) throw new Error('sidecar upload failed');
      await admin.from('tracks').update({ peaks_url: peaksUrl }).eq('id', t.id);
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
