import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { runPreviewBackfill } from '@/lib/audio/preview-backfill';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.backfill-previews');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Reading an ~80MB master + ffmpeg transcode is seconds per track; give the
// run headroom so a batch isn't cut off mid-transcode.
export const maxDuration = 60;

// How many tracks to process per invocation. Each one fetches the master and
// uploads a truncated copy, so we keep the batch small and process them
// sequentially to bound peak memory (one master in RAM at a time).
const BATCH = 8;

/**
 * Background preview backfill.
 *
 * The protected-preview clip is normally generated inline on upload, but tracks
 * uploaded before that feature (or that failed) still expose their full master
 * on the storefront. Re-running "Analyze N" in the dashboard does the same work
 * but inline (~20–30s/track, blocking the request). This cron drains the
 * backlog out-of-band: a small batch every 10 minutes (see vercel.json).
 *
 * Picks store-listed mp3/wav tracks whose preview isn't ready yet, generates
 * the truncated clip, and flips `preview_status='ready'`. Idempotent — once a
 * track is ready it's never re-picked, so the job is a no-op when the catalogue
 * is fully backfilled.
 */
export async function GET(req: NextRequest) {
  // Same cron auth as every other scheduled route: reject anything without the
  // CRON_SECRET bearer so the URL can't be triggered by a passer-by.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ skipped: 'Supabase not configured' });
  }

  const admin = createServiceClient();

  // `?scope=all` also backfills non-store-listed tracks (e.g. share/project-only
  // beats) so every preview_url gets populated, not just the storefront.
  // `?limit=N` (bounded) lets a manual drain process more than the daily batch.
  const scope = req.nextUrl.searchParams.get('scope');
  const limitParam = Number(req.nextUrl.searchParams.get('limit'));
  const batch = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 40) : BATCH;

  // Candidates: mp3/wav master missing EITHER the preview clip or the waveform
  // peaks sidecar. `.or` covers the legacy NULL and explicit 'none'/'pending'
  // preview states; peaks_url NULL means waveform surfaces must download and
  // decode audio client-side just to draw bars.
  let candidateQuery = admin
    .from('tracks')
    .select('id, audio_url, duration_seconds, preview_status, preview_url, peaks_url, store_listed, created_at')
    .or('preview_status.is.null,preview_status.neq.ready,preview_url.is.null,peaks_url.is.null');
  if (scope !== 'all') candidateQuery = candidateQuery.eq('store_listed', true);
  const { data: tracks, error } = await candidateQuery
    .order('created_at', { ascending: true })
    // Over-fetch a pool and choose the batch in pickPreviewBatch, so rows we
    // can't process (or that only need peaks) can't fill every slot.
    .limit(Math.min(batch * 25, 500));

  if (error) {
    // Most likely the preview_status column isn't in PostgREST's schema cache
    // yet (right after the migration deploy). Skip gracefully — the next run
    // picks up once `NOTIFY pgrst, 'reload schema'` has propagated.
    log.warn('candidate query failed (schema cache may be stale)', { error: error.message });
    return NextResponse.json({ skipped: 'candidate query failed', detail: error.message });
  }

  const result = await runPreviewBackfill(admin, tracks ?? [], batch);
  return NextResponse.json({ ...result, reasons: result.reasons.slice(0, 10) });
}
