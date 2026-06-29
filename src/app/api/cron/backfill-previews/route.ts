import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { makeTruncatedPreview } from '@/lib/audio/preview';
import { uploadPreviewAsset } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.backfill-previews');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  // Candidates: on the storefront, mp3/wav master, preview not yet ready.
  // `.or` covers both the legacy NULL and the explicit 'none'/'pending' states.
  const { data: tracks, error } = await admin
    .from('tracks')
    .select('id, audio_url, duration_seconds')
    .eq('store_listed', true)
    .or('preview_status.is.null,preview_status.neq.ready')
    .order('created_at', { ascending: true })
    .limit(BATCH);

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

  // Sequential on purpose: one master buffered at a time keeps memory bounded.
  for (const track of candidates) {
    try {
      const upstream = await fetch(track.audio_url as string);
      if (!upstream.ok) {
        failed++;
        log.warn('master fetch failed', { trackId: track.id, status: upstream.status });
        continue;
      }
      const len = Number(upstream.headers.get('content-length') ?? 0);
      if (len > MAX_MASTER_BYTES) {
        skippedTooLarge++;
        log.warn('master too large for serverless backfill', { trackId: track.id, bytes: len });
        continue;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX_MASTER_BYTES) {
        skippedTooLarge++;
        continue;
      }

      const { buffer: previewBuf, ext, contentType } = makeTruncatedPreview(
        buf,
        track.duration_seconds ?? null,
      );
      const previewUrl = await uploadPreviewAsset(track.audio_url as string, previewBuf, ext, contentType);
      if (!previewUrl) {
        failed++;
        log.warn('preview upload returned no url', { trackId: track.id });
        continue;
      }

      const { error: updErr } = await admin
        .from('tracks')
        .update({ preview_url: previewUrl, preview_status: 'ready' })
        .eq('id', track.id);
      if (updErr) {
        failed++;
        log.warn('preview status update failed', { trackId: track.id, error: updErr.message });
        continue;
      }
      processed++;
    } catch (err) {
      failed++;
      log.warn('preview backfill failed', { trackId: track.id, error: errorMessage(err) });
    }
  }

  log.info('backfill run complete', { processed, failed, skippedTooLarge, candidates: candidates.length });
  return NextResponse.json({ processed, failed, skippedTooLarge, candidates: candidates.length });
}
