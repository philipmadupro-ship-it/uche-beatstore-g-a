import 'server-only';

import { createServiceClient } from '@/lib/auth/ownership';
import { analyzeAudio } from '@/lib/audio/analyze.server';
import type { AudioFeatures } from '@/lib/audio/analyze.server';
import { getAuddFeatures } from '@/lib/audio/audd';
import { mergeFeatures } from '@/lib/audio/merge';
import { extractPeaks } from '@/lib/audio/peaks';
import { readStoredObject, uploadPeaksSidecar, uploadPublicPreview } from '@/lib/storage/upload';
import { prepareMp3Deliverable } from '@/lib/audio/mp3-deliverable';
import { realMp3Deps } from '@/lib/audio/mp3-deliverable.server';
import { errorMessage } from '@/lib/errors';
import { parseTitleMetadata } from '@/lib/upload/title-metadata';
import { compareFilenameWithDetected } from '@/lib/audio/metadata-agreement';

type UploadProcessingJob = {
  id: string;
  user_id: string;
  track_id: string;
  audio_url: string;
  file_name: string;
  client_analysis: Partial<AudioFeatures> | null;
  attempts: number;
};

export function sniffAudioBuffer(buf: Buffer): { ok: boolean; format: string } {
  if (buf.length < 12) return { ok: false, format: 'too-small' };
  const h = buf.subarray(0, 12);
  const s4 = (start: number) => h.subarray(start, start + 4).toString('latin1');
  const s3 = (start: number) => h.subarray(start, start + 3).toString('latin1');

  if (s4(0) === 'RIFF' && s4(8) === 'WAVE') return { ok: true, format: 'wav' };
  if (s3(0) === 'ID3') return { ok: true, format: 'mp3' };
  if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return { ok: true, format: 'mp3' };
  if (s4(0) === 'fLaC') return { ok: true, format: 'flac' };
  if (s4(0) === 'FORM' && s4(8) === 'AIFF') return { ok: true, format: 'aiff' };
  if (s4(0) === 'OggS') return { ok: true, format: 'ogg' };
  if (s4(4) === 'ftyp') return { ok: true, format: 'm4a' };
  return { ok: false, format: 'unknown' };
}

export async function enqueueUploadProcessingJob(opts: {
  trackId: string;
  userId: string;
  audioUrl: string;
  fileName: string;
  clientAnalysis?: Partial<AudioFeatures> | null;
}): Promise<string | null> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from('upload_processing_jobs')
    .insert({
      track_id: opts.trackId,
      user_id: opts.userId,
      audio_url: opts.audioUrl,
      file_name: opts.fileName,
      client_analysis: opts.clientAnalysis ?? null,
    })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Upload processing enqueue failed: ${error.message}`);
  return (data as { id?: string } | null)?.id ?? null;
}

/** Jobs retried at most this many times before they are left for a human. */
export const MAX_PROCESSING_ATTEMPTS = 5;

/**
 * A job whose worker died mid-run (function timeout, deploy, crash) stays in
 * `processing` forever unless something reclaims it. Past this age its lock is
 * treated as abandoned. Comfortably longer than the 300s function ceiling.
 */
export const STALE_PROCESSING_LOCK_MS = 15 * 60_000;

/**
 * PostgREST `or` filter for jobs a worker may claim: pending, failed, or
 * processing with an abandoned lock. The timestamp is an ISO string (no
 * commas), so it is safe to interpolate.
 */
export function claimableJobFilter(now: number): string {
  const staleBefore = new Date(now - STALE_PROCESSING_LOCK_MS).toISOString();
  return `status.in.(pending,failed),and(status.eq.processing,locked_at.lt.${staleBefore})`;
}

/**
 * Process one job straight after its upload completes, so a new beat gets its
 * peaks, preview and analysis in seconds instead of waiting for the daily
 * cron (which stays as the retry path). Never throws: a failure is recorded
 * on the job row for the cron to pick up.
 */
export async function processUploadProcessingJobById(id: string): Promise<{
  id: string;
  trackId: string;
  ok: boolean;
  error?: string;
} | null> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from('upload_processing_jobs')
    .select('id,user_id,track_id,audio_url,file_name,client_analysis,attempts')
    .eq('id', id)
    .lt('attempts', MAX_PROCESSING_ATTEMPTS)
    .maybeSingle();
  if (error || !data) return null;
  if (!(await claimJob(id))) return null;
  return processOneJob(data as UploadProcessingJob);
}

export async function processUploadProcessingBatch(limit = 3): Promise<{
  processed: number;
  failed: number;
  results: Array<{ id: string; trackId: string; ok: boolean; error?: string }>;
}> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from('upload_processing_jobs')
    .select('id,user_id,track_id,audio_url,file_name,client_analysis,attempts')
    .or(claimableJobFilter(Date.now()))
    .lt('attempts', MAX_PROCESSING_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 10)));
  if (error) throw new Error(`Upload processing lookup failed: ${error.message}`);

  const results: Array<{ id: string; trackId: string; ok: boolean; error?: string }> = [];
  for (const row of (data ?? []) as UploadProcessingJob[]) {
    const claimed = await claimJob(row.id);
    if (!claimed) continue;
    const result = await processOneJob(row);
    results.push(result);
  }

  return {
    processed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

async function claimJob(id: string): Promise<boolean> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from('upload_processing_jobs')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .or(claimableJobFilter(Date.now()))
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Upload processing claim failed: ${error.message}`);
  return Boolean(data);
}

async function processOneJob(job: UploadProcessingJob): Promise<{
  id: string;
  trackId: string;
  ok: boolean;
  error?: string;
}> {
  const admin = createServiceClient();
  try {
    const audioBuffer = await readStoredObject(job.audio_url);
    const sniff = sniffAudioBuffer(audioBuffer);
    if (!sniff.ok) {
      throw new Error(`Stored object is not supported audio (${sniff.format})`);
    }

    let serverAnalysis: AudioFeatures | null = null;
    try {
      serverAnalysis = await analyzeAudio(audioBuffer);
    } catch (err) {
      console.warn('Upload processing analysis failed:', err);
      serverAnalysis = { bpm: null, key: null, scale: null, loudness: null, duration: null };
    }

    let audd = { danceability: 0, energy: 0, valence: 0, acousticness: 0, tempo: 0 };
    try {
      audd = await getAuddFeatures(audioBuffer, job.file_name);
    } catch (err) {
      console.warn('Upload processing AudD failed:', err);
    }

    let peaksUrl: string | null = null;
    try {
      const peaks = await extractPeaks(audioBuffer);
      if (peaks) peaksUrl = await uploadPeaksSidecar(job.audio_url, JSON.stringify(peaks));
    } catch (err) {
      console.warn('Upload processing peaks failed:', err);
    }

    // Re-read the filename here too: this update runs after the track row
    // exists, so without it a detected tempo would overwrite the one the
    // producer wrote in the name.
    const titleMeta = parseTitleMetadata(job.file_name);
    const merged = mergeFeatures({
      title: titleMeta,
      client: job.client_analysis,
      server: serverAnalysis,
      audd,
    });
    // Tempo and harmony as the enqueuing route already wrote them: filename +
    // browser analysis, no server. Recomputed rather than read back so there
    // is nothing extra to store.
    const written = mergeFeatures({ title: titleMeta, client: job.client_analysis });

    // A disagreement the filename wins is still a disagreement; leave a trace.
    const disagreement = compareFilenameWithDetected(titleMeta, serverAnalysis);
    if (disagreement.conflicts.length) {
      console.warn('Upload processing: filename disagrees with server analysis (filename kept)', {
        trackId: job.track_id,
        conflicts: disagreement.conflicts,
      });
    }

    // The public 75 s clip /store streams (lib/audio/preview-clip). Without it
    // the beat is listed but 404s on play. Failure is non-fatal: the nightly
    // backfill and "Analyze N" retry any track left without one.
    let previewUrl: string | null = null;
    try {
      previewUrl = await uploadPublicPreview(audioBuffer, job.audio_url, merged.duration_seconds);
      if (!previewUrl) console.warn('Upload processing: no preview clip (ffmpeg unavailable and master not mp3/wav)');
    } catch (err) {
      console.warn('Upload processing preview failed:', err);
    }

    // The MP3 a lease on this track delivers, made now from the master already
    // in memory so the first buyer does not wait for it (it is otherwise made on
    // first download — lib/audio/mp3-deliverable). Non-fatal either way.
    const mp3 = await prepareMp3Deliverable({ id: job.track_id, audio_url: job.audio_url }, audioBuffer, realMp3Deps);
    if (!mp3 && job.audio_url && !/\.mp3(?:\?|$)/i.test(job.audio_url)) {
      console.warn('Upload processing: delivery MP3 not made (ffmpeg unavailable?); it will be made on first download');
    }

    const { bpm, key, scale, ...rest } = merged;
    const { error: trackError } = await admin
      .from('tracks')
      .update({
        ...rest,
        peaks_url: peaksUrl,
        preview_url: previewUrl,
        // Mig 099. Without 'ready' the backfill keeps re-picking a track that
        // already has its clip; 'none' is what makes it retry one that does not.
        preview_status: previewUrl ? 'ready' : 'none',
      })
      .eq('id', job.track_id)
      .eq('user_id', job.user_id);
    if (trackError) throw new Error(`Track update failed: ${trackError.message}`);

    // Tempo and harmony are compare-and-set: written only if the row still
    // holds what the enqueuing route wrote. This pass runs seconds to minutes
    // after the upload returned, and in that window the producer may have set
    // BPM or key themselves — one click in the uploads tray, or the track
    // drawer. Overwriting that with a detector's reading is exactly the
    // silent guess this pipeline must not make.
    await compareAndSet(admin, job, { bpm }, { bpm: written.bpm });
    await compareAndSet(admin, job, { key, scale }, { key: written.key, scale: written.scale });

    const { error: doneError } = await admin
      .from('upload_processing_jobs')
      .update({
        status: 'done',
        error: null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    if (doneError) throw new Error(`Job completion update failed: ${doneError.message}`);

    return { id: job.id, trackId: job.track_id, ok: true };
  } catch (err) {
    const message = errorMessage(err) || 'Upload processing failed';
    await admin
      .from('upload_processing_jobs')
      .update({
        status: 'failed',
        attempts: job.attempts + 1,
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return { id: job.id, trackId: job.track_id, ok: false, error: message };
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;
type Scalar = string | number | null;

/**
 * `UPDATE tracks SET <next> WHERE id AND user_id AND <each column = expected>`.
 * One statement, so there is no read-then-write window. A null expectation
 * matches with `IS NULL` (`= NULL` matches nothing in SQL).
 */
export async function compareAndSet(
  admin: ServiceClient,
  job: Pick<UploadProcessingJob, 'track_id' | 'user_id'>,
  next: Record<string, Scalar>,
  expected: Record<string, Scalar>,
): Promise<boolean> {
  const unchanged = Object.keys(next).every((k) => next[k] === expected[k]);
  if (unchanged) return true;
  let query = admin.from('tracks').update(next).eq('id', job.track_id).eq('user_id', job.user_id);
  for (const [column, value] of Object.entries(expected)) {
    query = value == null ? query.is(column, null) : query.eq(column, value);
  }
  const { data, error } = await query.select('id');
  if (error) throw new Error(`Track ${Object.keys(next).join('/')} update failed: ${error.message}`);
  const applied = Array.isArray(data) && data.length > 0;
  if (!applied) {
    console.info('Upload processing: kept a value set since upload', { trackId: job.track_id, fields: Object.keys(next) });
  }
  return applied;
}

