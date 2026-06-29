import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { extractPeaks } from '@/lib/audio/peaks';
import { uploadPeaksSidecar } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.backfill-peaks');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One master decoded per iteration; keep the batch small and sequential so peak
// memory stays bounded. Peaks extraction decodes audio, so it's heavier than
// the byte-slice preview path — a conservative batch.
const BATCH = 6;
const MAX_MASTER_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Background waveform-peaks backfill.
 *
 * Peaks are generated at upload, but tracks uploaded before that (or whose
 * extraction failed) have no `peaks_url` and fall back to a synthetic waveform
 * everywhere. Re-running "Analyze" backfills them but inline; this cron drains
 * the backlog out-of-band. Unlike previews (store-listed only), peaks benefit
 * every library track, so the scope is all tracks missing `peaks_url`.
 *
 * Idempotent — a track with peaks is never re-picked, so the job no-ops once
 * the catalogue is fully backfilled. CRON_SECRET-gated.
 */
export async function GET(req: NextRequest) {
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
  const { data: tracks, error } = await admin
    .from('tracks')
    .select('id, audio_url')
    .is('peaks_url', null)
    .not('audio_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(BATCH);

  if (error) {
    log.warn('candidate query failed', { error: error.message });
    return NextResponse.json({ skipped: 'candidate query failed', detail: error.message });
  }

  const candidates = tracks ?? [];
  let processed = 0;
  let failed = 0;
  let skippedTooLarge = 0;

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
        log.warn('master too large for serverless peaks backfill', { trackId: track.id, bytes: len });
        continue;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX_MASTER_BYTES) { skippedTooLarge++; continue; }

      const peaks = await extractPeaks(buf);
      if (!peaks) { failed++; log.warn('peaks extraction returned empty', { trackId: track.id }); continue; }

      const peaksUrl = await uploadPeaksSidecar(track.audio_url as string, JSON.stringify(peaks));
      if (!peaksUrl) { failed++; log.warn('peaks upload returned no url', { trackId: track.id }); continue; }

      const { error: updErr } = await admin.from('tracks').update({ peaks_url: peaksUrl }).eq('id', track.id);
      if (updErr) { failed++; log.warn('peaks_url update failed', { trackId: track.id, error: updErr.message }); continue; }
      processed++;
    } catch (err) {
      failed++;
      log.warn('peaks backfill failed', { trackId: track.id, error: errorMessage(err) });
    }
  }

  log.info('peaks backfill run complete', { processed, failed, skippedTooLarge, candidates: candidates.length });
  return NextResponse.json({ processed, failed, skippedTooLarge, candidates: candidates.length });
}
