import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { makeTruncatedPreview, DEFAULT_PREVIEW_SECONDS } from '@/lib/audio/preview';
import { uploadPreviewAsset, readStoredObject } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
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

// Skip masters bigger than this — a serverless function can't safely buffer an
// arbitrarily large WAV. These are logged for manual handling (re-encode to mp3
// or run the producer's "Analyze N" button locally).
const MAX_MASTER_BYTES = 100 * 1024 * 1024; // 100 MB

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

  // Candidates: mp3/wav master, preview not yet ready. `.or` covers both the
  // legacy NULL and the explicit 'none'/'pending' states.
  let candidateQuery = admin
    .from('tracks')
    .select('id, audio_url, duration_seconds')
    .or('preview_status.is.null,preview_status.neq.ready');
  if (scope !== 'all') candidateQuery = candidateQuery.eq('store_listed', true);
  const { data: tracks, error } = await candidateQuery
    .order('created_at', { ascending: true })
    .limit(batch);

  if (error) {
    // Most likely the preview_status column isn't in PostgREST's schema cache
    // yet (right after the migration deploy). Skip gracefully — the next run
    // picks up once `NOTIFY pgrst, 'reload schema'` has propagated.
    log.warn('candidate query failed (schema cache may be stale)', { error: error.message });
    return NextResponse.json({ skipped: 'candidate query failed', detail: error.message });
  }

  const candidates = (tracks ?? []).filter((t) => /\.(mp3|wav)(?:\?|$)/i.test(t.audio_url ?? ''));

  let processed = 0;
  let failed = 0;
  let skippedTooLarge = 0;
  const reasons: Array<{ id: string; stage: string; error: string }> = [];

  // Sequential on purpose: one master buffered at a time keeps memory bounded.
  for (const track of candidates) {
    try {
      // Read via the storage layer so private `r2://` refs resolve — a plain
      // fetch() only handles public http(s) URLs and silently failed on every
      // r2:// master, which is why the automated backfill never populated them.
      let buf: Buffer;
      try {
        buf = await readStoredObject(track.audio_url as string);
      } catch (e) {
        failed++;
        reasons.push({ id: track.id, stage: 'read', error: errorMessage(e) });
        continue;
      }
      if (!buf || buf.length === 0) {
        failed++;
        reasons.push({ id: track.id, stage: 'read', error: 'empty buffer' });
        continue;
      }
      if (buf.length > MAX_MASTER_BYTES) {
        skippedTooLarge++;
        log.warn('master too large for serverless backfill', { trackId: track.id, bytes: buf.length });
        continue;
      }

      // Prefer a small 96 kbps MP3 clip (ffmpeg); fall back to byte-truncation
      // when ffmpeg is unavailable so a preview is still produced.
      const { makePreviewMp3Buffer } = await import('@/lib/audio/convert');
      let previewBuf: Buffer, ext: 'mp3' | 'wav', contentType: string;
      try {
        const mp3 = await makePreviewMp3Buffer(buf, DEFAULT_PREVIEW_SECONDS);
        ({ buffer: previewBuf, ext, contentType } = mp3
          ? { buffer: mp3, ext: 'mp3' as const, contentType: 'audio/mpeg' }
          : makeTruncatedPreview(buf, track.duration_seconds ?? null));
      } catch (e) {
        failed++;
        reasons.push({ id: track.id, stage: 'transcode', error: errorMessage(e) });
        continue;
      }
      let previewUrl: string | null;
      try {
        previewUrl = await uploadPreviewAsset(track.audio_url as string, previewBuf, ext, contentType);
      } catch (e) {
        failed++;
        reasons.push({ id: track.id, stage: 'upload', error: errorMessage(e) });
        continue;
      }
      if (!previewUrl) {
        failed++;
        reasons.push({ id: track.id, stage: 'upload', error: 'no url returned' });
        continue;
      }

      const { error: updErr } = await admin
        .from('tracks')
        .update({ preview_url: previewUrl, preview_status: 'ready' })
        .eq('id', track.id);
      if (updErr) {
        failed++;
        reasons.push({ id: track.id, stage: 'db', error: updErr.message });
        continue;
      }
      processed++;
    } catch (err) {
      failed++;
      reasons.push({ id: track.id, stage: 'unknown', error: errorMessage(err) });
      log.warn('preview backfill failed', { trackId: track.id, error: errorMessage(err) });
    }
  }

  log.info('backfill run complete', { processed, failed, skippedTooLarge, candidates: candidates.length });
  return NextResponse.json({ processed, failed, skippedTooLarge, candidates: candidates.length, reasons: reasons.slice(0, 10) });
}
