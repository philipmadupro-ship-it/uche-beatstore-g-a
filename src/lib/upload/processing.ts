import 'server-only';

import { createServiceClient } from '@/lib/auth/ownership';
import { analyzeAudio } from '@/lib/audio/analyze.server';
import type { AudioFeatures } from '@/lib/audio/analyze.server';
import { getAuddFeatures } from '@/lib/audio/audd';
import { mergeFeatures } from '@/lib/audio/merge';
import { extractPeaks } from '@/lib/audio/peaks';
import { readStoredObject, uploadPeaksSidecar, uploadPublicPreview } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';

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

    let previewUrl: string | null = null;
    try {
      previewUrl = await uploadPublicPreview(audioBuffer);
    } catch (err) {
      console.warn('Upload processing preview failed:', err);
    }

    const merged = mergeFeatures({
      client: job.client_analysis,
      server: serverAnalysis,
      audd,
    });

    const { error: trackError } = await admin
      .from('tracks')
      .update({
        ...merged,
        peaks_url: peaksUrl,
        preview_url: previewUrl,
      })
      .eq('id', job.track_id)
      .eq('user_id', job.user_id);
    if (trackError) throw new Error(`Track update failed: ${trackError.message}`);

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
