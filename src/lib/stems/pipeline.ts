/**
 * Asynchronous stem pipeline (AUDIO-05): enqueue -> dispatch/poll -> ingest.
 *
 * Stages are separate and none of them runs inside a user's request:
 *   enqueue   POST /api/stems writes a `pending` row and returns.
 *   process   `processStemBatch` (after() once enqueued; the process-stems cron
 *             is the retry path) claims a row, submits it to the backend, polls
 *             it, and ingests the four stems into the PRIVATE bucket.
 *   playback  the producer's /api/audio proxy streams the stored r2:// refs.
 *
 * A driver run is bounded by `budgetMs`. A backend job still running when the
 * budget ends goes back to `pending` WITH its job_id, so the next run resumes
 * polling instead of submitting again. A driver that dies leaves a `processing`
 * row whose lock goes stale; the next run reclaims it (see lifecycle.ts).
 */
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { stemName } from '@/lib/naming';
import {
  afterFailure, decideAfterPoll, isActive, isClaimable, isExhausted, isPermanentError,
  type BackendStatus,
} from './lifecycle';
import type { StemRowFull, StemStore, StemPatch } from './store';

const log = createLogger('stems.pipeline');

export const CORE_STEMS = ['vocals', 'drums', 'bass', 'other'] as const;

export interface BackendPoll {
  status: BackendStatus;
  error: string | null;
  /** stem name -> backend download reference */
  stems: Record<string, string>;
}

export interface PipelineDeps {
  store: StemStore;
  backend: {
    /** Submit the track's audio; returns a prefixed job id. */
    start(sourceRef: string): Promise<string>;
    poll(jobId: string): Promise<BackendPoll>;
    download(jobId: string, stem: string, ref?: string): Promise<Buffer>;
  };
  /** Write one stem to the PRIVATE bucket and return its r2:// reference. */
  putStem(buffer: Buffer, filename: string): Promise<string>;
  /** All four stems are stored (buyer delivery emails etc.). Best effort. */
  onDone(trackId: string): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  pollIntervalMs: number;
}

export type EnqueueResult =
  | { ok: true; row: StemRowFull }
  | { ok: false; reason: 'active'; row: StemRowFull }
  | { ok: false; reason: 'no_audio' | 'no_track' };

/** The audio a split is made from: the owned track row, never a client URL. */
export function stemSourceOf(track: { audio_url: string | null; wav_url: string | null }): string | null {
  return track.wav_url || track.audio_url || null;
}

/**
 * Queue a split for a track the caller has already been verified to own.
 * One row per track: a retry RESETS it (the UNIQUE track_id makes a second
 * insert fail), but never while a live job is running.
 */
export async function enqueueStemJob(deps: Pick<PipelineDeps, 'store' | 'now'>, trackId: string): Promise<EnqueueResult> {
  const { store } = deps;
  const track = await store.loadTrack(trackId);
  if (!track) return { ok: false, reason: 'no_track' };
  if (!stemSourceOf(track)) return { ok: false, reason: 'no_audio' };

  const now = deps.now();
  const locks = await store.hasLocks();
  const existing = await store.findByTrack(trackId);

  let row: StemRowFull | null;
  if (!existing) {
    row = await store.create(trackId);
    if (!row) {
      const raced = await store.findByTrack(trackId);
      return raced ? { ok: false, reason: 'active', row: raced } : { ok: false, reason: 'no_track' };
    }
  } else {
    if (isActive(existing, now, locks)) return { ok: false, reason: 'active', row: existing };
    row = await store.reset(existing, now);
    if (!row) {
      const raced = await store.findByTrack(trackId);
      return raced ? { ok: false, reason: 'active', row: raced } : { ok: false, reason: 'no_track' };
    }
  }
  await store.setTrackStatus(trackId, 'pending');
  return { ok: true, row };
}

async function failRow(deps: PipelineDeps, row: StemRowFull, error: string, patch: StemPatch = {}) {
  await deps.store.patch(row, { status: 'failed', last_error: error, locked_at: null, ...patch }, deps.now());
  await deps.store.setTrackStatus(row.track_id, 'failed');
}

/** One claimed row, start to finish or until the budget runs out. */
async function runJob(deps: PipelineDeps, claimed: StemRowFull, deadline: number): Promise<'done' | 'failed' | 'waiting' | 'retry'> {
  const { store } = deps;
  let row = claimed;
  const locks = await store.hasLocks();
  let jobId = row.job_id;
  try {
    const track = await store.loadTrack(row.track_id);
    const source = track ? stemSourceOf(track) : null;
    if (!track || !source) {
      await failRow(deps, row, 'The track has no audio to split.');
      return 'failed';
    }

    if (!jobId) {
      jobId = await deps.backend.start(source);
      await store.patch(row, { job_id: jobId }, deps.now());
      row = { ...row, job_id: jobId };
    }

    for (;;) {
      const polled = await deps.backend.poll(jobId);
      const decision = decideAfterPoll(polled.status, polled.error);
      if (decision.kind === 'fail') {
        // The backend ran the job and it errored: a fresh submit may still work, until attempts run out.
        const out = afterFailure(row, decision.error, deps.now(), locks, isPermanentError(decision.error));
        await store.patch(row, {
          status: out.status, attempts: out.attempts, last_error: out.error, locked_at: null, job_id: null,
        }, deps.now());
        await store.setTrackStatus(row.track_id, out.status);
        return out.status === 'failed' ? 'failed' : 'retry';
      }
      if (decision.kind === 'ingest') break;
      if (deps.now() + deps.pollIntervalMs > deadline) {
        // Still running at the end of this run's budget: hand it back, job id kept.
        await store.patch(row, { status: 'pending', locked_at: null }, deps.now());
        return 'waiting';
      }
      await deps.sleep(deps.pollIntervalMs);
    }

    // ingest: every core stem must reach the private bucket, or the job is not done.
    const polled = await deps.backend.poll(jobId);
    const urls: Record<string, string> = {};
    for (const name of CORE_STEMS) {
      const buffer = await deps.backend.download(jobId, name, polled.stems[name]);
      const filename = `${stemName(track.title || 'Track', name).replace(/[^\w\-— ]+/g, '').trim() || `stem-${name}`}.wav`;
      urls[name] = await deps.putStem(buffer, filename);
    }
    await store.patch(row, {
      status: 'done', last_error: null, locked_at: null,
      vocals_url: urls.vocals, drums_url: urls.drums, bass_url: urls.bass, other_url: urls.other,
    }, deps.now());
    await store.setTrackStatus(row.track_id, 'done');
    try { await deps.onDone(row.track_id); } catch (err) {
      log.warn('stem onDone failed', { trackId: row.track_id, error: errorMessage(err) });
    }
    return 'done';
  } catch (err) {
    const message = errorMessage(err);
    // A backend that no longer knows the job (service restarted) needs a fresh submit.
    const lost = /not found|\b404\b/i.test(message);
    const out = afterFailure(row, message, deps.now(), locks, isPermanentError(message) && !lost);
    try {
      await store.patch(row, {
        status: out.status, attempts: out.attempts, last_error: out.error, locked_at: null,
        ...(lost ? { job_id: null } : {}),
      }, deps.now());
      await store.setTrackStatus(row.track_id, out.status);
    } catch (writeErr) {
      log.error('stem failure could not be recorded', { trackId: row.track_id, error: errorMessage(writeErr) });
    }
    log.warn('stem job errored', { trackId: row.track_id, status: out.status, error: message });
    return out.status === 'failed' ? 'failed' : 'retry';
  }
}

export interface BatchResult {
  claimed: number; done: number; failed: number; waiting: number; retry: number; expired: number;
}

/**
 * Drive queued and crashed stem jobs. Idempotent: a row another driver holds
 * fails its compare-and-set claim and is skipped, a finished row is not listed.
 * `onlyTrackId` limits a run to one track (the after() kick from enqueue).
 */
export async function processStemBatch(
  deps: PipelineDeps,
  opts: { limit?: number; budgetMs?: number; onlyTrackId?: string } = {},
): Promise<BatchResult> {
  const { store } = deps;
  const result: BatchResult = { claimed: 0, done: 0, failed: 0, waiting: 0, retry: 0, expired: 0 };
  const deadline = deps.now() + (opts.budgetMs ?? 240_000);
  const locks = await store.hasLocks();
  const work = await store.listWork(opts.limit ?? 5);

  for (const candidate of work) {
    if (opts.onlyTrackId && candidate.track_id !== opts.onlyTrackId) continue;
    if (deps.now() >= deadline) break;
    const now = deps.now();
    if (!isClaimable(candidate, now, locks)) continue;

    if (isExhausted(candidate, now, locks)) {
      // Out of time or attempts: say so instead of leaving it queued forever.
      await failRow(deps, candidate, candidate.last_error || 'Stem separation did not finish in time.', {
        attempts: candidate.attempts ?? 0,
      });
      result.expired += 1;
      continue;
    }

    const claimed = await store.claim(candidate, now);
    if (!claimed) continue;
    result.claimed += 1;
    const outcome = await runJob(deps, claimed, deadline);
    result[outcome] += 1;
  }
  return result;
}
