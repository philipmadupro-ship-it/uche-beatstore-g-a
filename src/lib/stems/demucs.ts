/**
 * Client for the local Demucs stem separation service.
 * Service runs at DEMUCS_SERVICE_URL (default: http://localhost:8001).
 *
 * API contract:
 *   POST /api/v1/separate        → { job_id, status, message }
 *   GET  /api/v1/jobs/:id        → { job_id, status, progress, stems, error, model }
 *   GET  /api/v1/stems/:id/:name → WAV file download
 */

const DEMUCS_URL = process.env.DEMUCS_SERVICE_URL ?? 'http://localhost:8001';

export interface DemucsJob {
  job_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;          // 0–100
  stems: Record<string, string>; // stem name → download URL on the service
  error?: string | null;
  model: string;
}

/**
 * Submit an audio file URL to the Demucs service for stem separation.
 * The service fetches the file from `audioUrl` — it must be publicly reachable
 * from the service container (localhost URLs won't work in Docker; use R2/S3 URLs).
 *
 * For local dev with local audio files, we proxy the file through this function
 * by downloading it server-side first and re-uploading as a multipart form.
 *
 * Returns the job_id to poll.
 */
export async function startStemSplit(
  audioUrl: string,
  model: string = 'htdemucs',
): Promise<string> {
  // Download the audio file server-side so we can re-upload it as multipart
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`Failed to fetch audio for stem split: ${audioRes.statusText}`);
  }

  const audioBlob = await audioRes.blob();
  const filename = audioUrl.split('/').pop() ?? 'audio.wav';
  return startStemSplitFromBlob(audioBlob, filename, model);
}

/** Submit audio bytes the caller already holds (a private object read server-side). */
export async function startStemSplitFromBlob(
  audioBlob: Blob,
  filename: string,
  model: string = 'htdemucs',
): Promise<string> {
  const form = new FormData();
  form.append('file', audioBlob, filename);
  form.append('model', model);

  const res = await fetch(`${DEMUCS_URL}/api/v1/separate`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(`Demucs service error: ${err.detail ?? res.statusText}`);
  }

  const data = await res.json();
  return data.job_id as string;
}

/**
 * Poll a job's status and progress.
 */
export async function getStemJob(jobId: string): Promise<DemucsJob> {
  const res = await fetch(`${DEMUCS_URL}/api/v1/jobs/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(`Demucs job poll error: ${err.detail ?? res.statusText}`);
  }
  return res.json() as Promise<DemucsJob>;
}

/**
 * Build the public download URL for a stem.
 * In production, stems should be uploaded to R2/S3 and this returns the CDN URL.
 * In local dev, this proxies through your Next.js API.
 */
export function buildStemProxyUrl(jobId: string, stemName: string): string {
  return `/api/stems/${jobId}/${stemName}`;
}
