import { buildPreviewClip } from '@/lib/audio/preview-clip';
import { uploadPreviewAsset, uploadPeaksSidecar, readStoredObject } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { pickPreviewBatch, needsPreview, type PreviewCandidateRow } from '@/lib/audio/preview-candidates';
import { createLogger } from '@/lib/log';

const log = createLogger('audio.preview-backfill');

// Skip masters bigger than this — a serverless function can't safely buffer an
// arbitrarily large WAV. These are reported so the producer can re-export.
export const MAX_MASTER_BYTES = 100 * 1024 * 1024; // 100 MB

export interface PreviewBackfillRow extends PreviewCandidateRow {
  duration_seconds?: number | null;
}

export interface PreviewBackfillResult {
  processed: number;
  failed: number;
  skippedTooLarge: number;
  candidates: number;
  reasons: Array<{ id: string; stage: string; error: string }>;
}

/**
 * Generate missing preview clips (and peaks) for a pool of tracks.
 *
 * Shared by the nightly cron and the producer's "Generate missing previews"
 * button in the Store Editor, so the two cannot drift. It used to live only in
 * the cron, where its per-track failure reasons went to logs nobody reads —
 * three listed beats sat unplayable on /store for ten days that way.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function runPreviewBackfill(
  admin: any,
  tracks: PreviewBackfillRow[],
  batch: number,
): Promise<PreviewBackfillResult> {
  const candidates = pickPreviewBatch(tracks, batch);

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

      const patch: Record<string, string> = {};

      // ── Preview clip (only when not already ready) ──────────────────────
      if (needsPreview(track)) {
        // lib/audio/preview-clip: 75 s MP3 via ffmpeg, else byte-truncated mp3/wav.
        let previewBuf: Buffer, ext: 'mp3' | 'wav', contentType: string;
        try {
          const clip = await buildPreviewClip(buf, track.audio_url, track.duration_seconds ?? null);
          if (!clip) throw new Error('ffmpeg unavailable and master is not mp3/wav');
          ({ buffer: previewBuf, ext, contentType } = clip);
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
        patch.preview_url = previewUrl;
        patch.preview_status = 'ready';
      }

      // ── Waveform peaks sidecar (when missing) ───────────────────────────
      // Without peaks_url every waveform surface downloads + decodes audio
      // client-side just to draw bars. Best-effort: a peaks failure never
      // blocks the preview from being persisted.
      if (!track.peaks_url) {
        try {
          const { extractPeaks } = await import('@/lib/audio/peaks');
          const peaks = await extractPeaks(buf);
          if (peaks) {
            const peaksUrl = await uploadPeaksSidecar(track.audio_url as string, JSON.stringify(peaks));
            if (peaksUrl) patch.peaks_url = peaksUrl;
          }
        } catch (e) {
          reasons.push({ id: track.id, stage: 'peaks', error: errorMessage(e) });
          log.warn('peaks backfill failed', { trackId: track.id, error: errorMessage(e) });
        }
      }

      if (Object.keys(patch).length === 0) {
        // Nothing produced (e.g. only peaks were needed and they failed).
        failed++;
        continue;
      }
      const { error: updErr } = await admin
        .from('tracks')
        .update(patch)
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
  return { processed, failed, skippedTooLarge, candidates: candidates.length, reasons: reasons.slice(0, 20) };
}
