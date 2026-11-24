/**
 * Stem-separation backend dispatcher.
 *
 * Two backends are supported:
 *
 *   - **Demucs**: a self-hosted FastAPI service (see `stem-service/`) running
 *     on `DEMUCS_SERVICE_URL` (default `http://localhost:8001`). Free, fast,
 *     but requires an operator to keep the GPU host alive.
 *
 *   - **Moises**: hosted SaaS at api.moises.ai. Requires `MOISES_API_KEY`.
 *     Slower (queued) but no infra to run.
 *
 * Selection rule: if Demucs is reachable, use it. Otherwise, if MOISES_API_KEY
 * is set, use Moises. Otherwise the call fails with a clear 503 message.
 *
 * Job IDs are prefixed with the backend (`demucs:xxx` / `moises:xxx`) so the
 * polling endpoint can route the right way without an extra DB column.
 * Bare (un-prefixed) IDs are assumed Demucs for backwards compatibility
 * with rows inserted before the dispatcher existed.
 */

import {
  startStemSplitFromBlob as demucsStartBlob,
  getStemJob as demucsPoll,
  type DemucsJob,
} from '@/lib/stems/demucs';
import {
  startStemSplit as moisesStart,
  getStemSplitStatus as moisesPoll,
} from '@/lib/stems/moises';

import { getPresignedUrl, readStoredObject } from '@/lib/storage/upload';

const DEMUCS_URL = process.env.DEMUCS_SERVICE_URL ?? 'http://localhost:8001';

export type StemBackend = 'demucs' | 'moises';

export interface NormalizedStemJob {
  /** Full prefixed job id, e.g. "moises:abc123" */
  job_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  /** Stem name → download URL. For Demucs, points at the service so the
   *  caller still needs to fetch + re-upload to R2. For Moises, points
   *  directly at Moises' CDN — also caller's job to mirror to R2 if
   *  durability matters. */
  stems: Record<string, string>;
  error: string | null;
  model: string;
  backend: StemBackend;
}

// ---------- backend selection ----------------------------------------

async function isDemucsHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${DEMUCS_URL}/api/v1/health`, {
      // Short timeout — we don't want a 30s connect-timeout to mask a
      // routine "not running" state.
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function isMoisesConfigured(): boolean {
  return Boolean(process.env.MOISES_API_KEY);
}

/**
 * Picks a backend. Returns null if neither is available — the caller should
 * surface a 503 with the included message.
 */
export async function pickBackend(): Promise<
  | { ok: true; backend: StemBackend }
  | { ok: false; reason: string }
> {
  if (await isDemucsHealthy()) return { ok: true, backend: 'demucs' };
  if (isMoisesConfigured()) return { ok: true, backend: 'moises' };
  return {
    ok: false,
    reason:
      'No stem-separation backend available. Either start the Demucs ' +
      'service (cd stem-service && uvicorn main:app --port 8001) or set ' +
      'MOISES_API_KEY in your environment.',
  };
}

// ---------- start --------------------------------------------------

/**
 * Start a stem-split job on the selected backend from the track's stored audio
 * reference (an `r2://` master, a local path or an https URL). Demucs gets the
 * bytes, read server-side, so a private master never needs a public URL;
 * Moises can only fetch a URL, so a private reference gets a short-lived
 * presigned one. Returns a *prefixed* job_id so polling can route later.
 */
export async function startJobFromSource(
  sourceRef: string,
  model: string = 'htdemucs',
): Promise<{ jobId: string; backend: StemBackend }> {
  const pick = await pickBackend();
  if (!pick.ok) throw new Error(pick.reason);

  if (pick.backend === 'demucs') {
    const bytes = await readStoredObject(sourceRef);
    const filename = sourceRef.split('/').pop()?.split('?')[0] || 'audio.wav';
    const id = await demucsStartBlob(new Blob([new Uint8Array(bytes)]), filename, model);
    return { jobId: `demucs:${id}`, backend: 'demucs' };
  }
  const url = sourceRef.startsWith('r2://') ? await getPresignedUrl(sourceRef) : sourceRef;
  const id = await moisesStart(url);
  return { jobId: `moises:${id}`, backend: 'moises' };
}

// ---------- poll ---------------------------------------------------

interface ParsedJobId {
  backend: StemBackend;
  rawId: string;
}

export function parseJobId(jobId: string): ParsedJobId {
  if (jobId.startsWith('demucs:')) return { backend: 'demucs', rawId: jobId.slice(7) };
  if (jobId.startsWith('moises:')) return { backend: 'moises', rawId: jobId.slice(7) };
  // Pre-dispatcher rows had bare Demucs IDs.
  return { backend: 'demucs', rawId: jobId };
}

export async function pollJob(jobId: string): Promise<NormalizedStemJob> {
  const { backend, rawId } = parseJobId(jobId);
  if (backend === 'demucs') {
    const job: DemucsJob = await demucsPoll(rawId);
    return {
      job_id: jobId,
      status: job.status,
      progress: job.progress ?? 0,
      stems: job.stems ?? {},
      error: job.error ?? null,
      model: job.model ?? 'htdemucs',
      backend: 'demucs',
    };
  }

  // Moises
  const job = await moisesPoll(rawId);
  // Normalize Moises status → our enum. Moises may return 'pending',
  // 'processing', 'done', or 'failed' (we mapped 'error' → 'failed' in
  // the moises lib). Map back to 'error' for callers that branch on it.
  const status: NormalizedStemJob['status'] =
    job.status === 'failed' ? 'error' : job.status;
  // Moises doesn't expose granular progress — synthesize plausible values
  // so the UI bar doesn't sit at 0% forever.
  const progress =
    status === 'done' ? 100 :
    status === 'processing' ? 50 :
    status === 'pending' ? 5 : 0;

  return {
    job_id: jobId,
    status,
    progress,
    stems: job.result
      ? {
          vocals: job.result.vocals,
          drums: job.result.drums,
          bass: job.result.bass,
          other: job.result.other,
        }
      : {},
    error: status === 'error' ? 'Moises job failed' : null,
    model: 'moises/stems-4',
    backend: 'moises',
  };
}

/**
 * Download a stem from whichever backend produced it. Returns a Buffer the
 * caller can re-upload to R2.
 */
export async function downloadStem(
  jobId: string,
  stemName: string,
  cdnUrl?: string,
): Promise<Buffer> {
  const { backend, rawId } = parseJobId(jobId);
  // For Moises, we already have the direct URL in the poll response, so
  // the caller passes it in. For Demucs, build it from the service URL.
  const url = backend === 'demucs'
    ? `${DEMUCS_URL}/api/v1/stems/${rawId}/${stemName}`
    : cdnUrl;
  if (!url) throw new Error(`No download URL for ${backend} stem ${stemName}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stem download failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
