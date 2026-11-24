/**
 * Stem job lifecycle (AUDIO-05) — pure rules, no I/O.
 *
 * The `stems` row IS the job. Its status:
 *   pending     queued, or submitted to a backend and waiting for the next poll
 *               (job_id says which: null = not submitted yet)
 *   processing  claimed by a driver right now
 *   done | failed
 *
 * `tracks.stems_status` mirrors it as pending | done | failed (the CHECK from
 * 001; 'processing' is not in it), see `trackStatusFor`.
 *
 * Migration 205 adds attempts / last_error / locked_at / updated_at. Before it
 * is applied the pipeline runs REDUCED: claim by status alone, the lock age is
 * the row's created_at, no attempt count and no stored error. Every rule here
 * takes `locks` (whether those columns exist) so both modes are one code path.
 */

export type StemJobStatus = 'pending' | 'processing' | 'done' | 'failed';

/** A processing row older than this is a crashed driver, not a slow one. */
export const STALE_LOCK_MS = 15 * 60_000;
/** Attempts a job gets (a lost or errored run counts one) before it is failed. */
export const MAX_ATTEMPTS = 3;
/** Past this age a job is failed whatever else is true (bounds reduced mode). */
export const MAX_JOB_AGE_MS = 2 * 60 * 60_000;

export interface StemJobRow {
  id: string;
  track_id: string;
  job_id: string | null;
  status: StemJobStatus | string | null;
  attempts?: number | null;
  last_error?: string | null;
  locked_at?: string | null;
  created_at?: string | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** When the current claim began: locked_at, or created_at without migration 205. */
export function lockedSince(row: StemJobRow, locks: boolean): number | null {
  return locks ? ms(row.locked_at) ?? ms(row.created_at) : ms(row.created_at);
}

export function isStale(row: StemJobRow, now: number, locks: boolean): boolean {
  if (row.status !== 'processing') return false;
  const since = lockedSince(row, locks);
  // No readable timestamp: nothing proves it is live, so treat it as stale.
  return since === null || now - since > STALE_LOCK_MS;
}

/** True when the job has run out of time or attempts and must be failed. */
export function isExhausted(row: StemJobRow, now: number, locks: boolean): boolean {
  const created = ms(row.created_at);
  if (created !== null && now - created > MAX_JOB_AGE_MS) return true;
  return locks && (row.attempts ?? 0) >= MAX_ATTEMPTS;
}

/** Work a driver may pick up: queued rows and crashed claims. */
export function isClaimable(row: StemJobRow, now: number, locks: boolean): boolean {
  return row.status === 'pending' || isStale(row, now, locks);
}

/** A request to (re)start: is a live job already running for this track? */
export function isActive(row: StemJobRow | null, now: number, locks: boolean): boolean {
  if (!row) return false;
  if (row.status === 'pending') return !isExhausted(row, now, locks);
  if (row.status === 'processing') return !isStale(row, now, locks);
  return false;
}

export function trackStatusFor(status: StemJobStatus): 'pending' | 'done' | 'failed' {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  return 'pending';
}

export type BackendStatus = 'pending' | 'processing' | 'done' | 'error';

export type PollDecision =
  | { kind: 'wait' }
  | { kind: 'ingest' }
  | { kind: 'fail'; error: string };

/** What the driver does with what the backend just said. */
export function decideAfterPoll(backend: BackendStatus, backendError: string | null): PollDecision {
  if (backend === 'done') return { kind: 'ingest' };
  if (backend === 'error') return { kind: 'fail', error: backendError || 'The stem separation backend reported an error.' };
  return { kind: 'wait' };
}

/**
 * After a driver run that threw: retry (back to pending, attempt counted) or
 * give up. Without lock columns there is no counter, so a throw is retried
 * until MAX_JOB_AGE_MS fails it.
 */
export function afterFailure(
  row: StemJobRow,
  error: string,
  now: number,
  locks: boolean,
  permanent = false,
): { status: 'pending' | 'failed'; attempts: number; error: string } {
  const attempts = (row.attempts ?? 0) + 1;
  if (permanent || isExhausted({ ...row, attempts }, now, locks)) {
    return { status: 'failed', attempts, error };
  }
  return { status: 'pending', attempts, error };
}

/** Errors that no retry can fix. */
export function isPermanentError(message: string): boolean {
  return /not supported audio|no audio|not found|missing_audio|invalid/i.test(message);
}

/** Producer-facing text for a failed job. */
export function failureText(row: Pick<StemJobRow, 'last_error'>): string {
  return row.last_error?.trim() || 'Stem separation failed. Retry the split, or upload stems manually.';
}
