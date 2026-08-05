/**
 * Pure helpers for upload progress, throughput and de-duplication.
 *
 * These live outside the Zustand store on purpose. Progress maths is exactly
 * the kind of logic that reads as "obviously right" inline in a component,
 * silently regresses, and is never noticed because a progress bar that is
 * subtly wrong still looks like a progress bar. See CLAUDE.md, "Pure-logic
 * extract".
 */

/** An upload identified well enough to spot the same file being dropped twice. */
export interface FileIdentity {
  fileName: string;
  fileSize: number;
  fileLastModified: number;
}

/**
 * Statuses where an upload is still on its way to the bucket. Re-dropping a
 * file that is in one of these is a double-submit, not a new upload.
 *
 * `error` and `interrupted` are deliberately absent: those are the states a
 * user re-drops a file to recover from, so matching them would make recovery
 * impossible.
 */
export const LIVE_STATUSES = [
  'queued', 'preparing', 'uploading', 'finalizing', 'paused',
] as const;

export type LiveStatus = (typeof LIVE_STATUSES)[number];

export function isLiveStatus(status: string): status is LiveStatus {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.fileName === b.fileName
    && a.fileSize === b.fileSize
    && a.fileLastModified === b.fileLastModified;
}

/**
 * Find an in-flight upload of the same file.
 *
 * Returns its id so the caller can surface the existing row rather than start a
 * second multipart session — two sessions for one file means two R2 objects,
 * two `/complete` calls and two track rows, which is precisely the duplicate
 * the producer then has to clean up by hand.
 */
export function findLiveDuplicate<T extends FileIdentity & { id: string; status: string }>(
  uploads: readonly T[],
  candidate: FileIdentity,
): string | null {
  const hit = uploads.find((u) => isLiveStatus(u.status) && sameFile(u, candidate));
  return hit ? hit.id : null;
}

/**
 * Bytes confirmed on the server, given the completed part numbers.
 *
 * The naive `count * partSize` overcounts whenever the final part is among the
 * completed ones, because the final part is almost always short. On a 101 MB
 * file in 8 MiB parts that is a progress bar that reads 100% while three more
 * parts are still uploading.
 */
export function bytesFromParts(opts: {
  completedPartNumbers: readonly number[];
  partSize: number;
  totalParts: number;
  fileSize: number;
}): number {
  const { completedPartNumbers, partSize, totalParts, fileSize } = opts;
  if (partSize <= 0) return 0;

  let total = 0;
  for (const part of completedPartNumbers) {
    if (part < 1) continue;
    const start = (part - 1) * partSize;
    if (fileSize > 0 && start >= fileSize) continue;
    // The last part runs to end-of-file, not to a full partSize.
    const isLast = totalParts > 0 && part >= totalParts;
    total += isLast && fileSize > 0 ? Math.max(0, fileSize - start) : partSize;
  }
  return fileSize > 0 ? Math.min(fileSize, total) : total;
}

/**
 * Total displayed bytes: confirmed parts plus whatever the in-flight parts have
 * pushed so far. Without the in-flight term the bar only moves once per part,
 * so an 8 MiB chunk on a slow line looks frozen for a minute at a time.
 */
export function displayedBytes(opts: {
  confirmedBytes: number;
  inFlight: Readonly<Record<number, number>>;
  fileSize: number;
}): number {
  let total = opts.confirmedBytes;
  for (const key of Object.keys(opts.inFlight)) total += opts.inFlight[Number(key)] || 0;
  return opts.fileSize > 0 ? Math.min(opts.fileSize, Math.max(0, total)) : Math.max(0, total);
}

/**
 * Smoothed throughput for the CURRENT run.
 *
 * `baselineBytes` is what was already uploaded when this run started — bytes
 * carried over from a previous session or a resume. Counting them against this
 * run's elapsed time reports a resumed upload as several times faster than the
 * line actually is, and the ETA inherits the error.
 */
export function computeSpeedBps(opts: {
  bytesUploaded: number;
  baselineBytes: number;
  elapsedMs: number;
  previousBps: number;
  /** Weight given to the running average. 0 = ignore history. */
  smoothing?: number;
}): number {
  const { bytesUploaded, baselineBytes, elapsedMs, previousBps } = opts;
  const smoothing = opts.smoothing ?? 0.7;
  if (elapsedMs <= 0) return previousBps;

  const movedThisRun = Math.max(0, bytesUploaded - baselineBytes);
  const instant = movedThisRun / (elapsedMs / 1000);
  if (!Number.isFinite(instant)) return previousBps;
  return previousBps <= 0 ? instant : previousBps * smoothing + instant * (1 - smoothing);
}

/** Seconds remaining, or null when there is nothing sensible to report yet. */
export function computeEtaSec(opts: {
  bytesUploaded: number;
  fileSize: number;
  speedBps: number;
}): number | null {
  const { bytesUploaded, fileSize, speedBps } = opts;
  if (speedBps <= 0 || !Number.isFinite(speedBps)) return null;
  if (fileSize <= 0) return null;
  const remaining = Math.max(0, fileSize - bytesUploaded);
  if (remaining === 0) return 0;
  return Math.round(remaining / speedBps);
}

/**
 * Backoff before retrying a chunk: 500ms, 1s, 2s, 4s, 8s, capped at 15s, with
 * jitter so several parallel chunk workers that failed on the same network
 * blip do not all retry on the same tick and re-break the connection.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15_000, 500 * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.round(base * (0.75 + random() * 0.5));
}

/**
 * Whether a failed chunk deserves another attempt.
 *
 * A network-level failure (status 0 — offline, DNS, dropped socket) is a
 * transient we should keep retrying; the user's wifi coming back should not
 * cost them a 300 MB re-upload. A 4xx is the server telling us this request is
 * wrong and will stay wrong, so retrying just burns the attempt budget. 408 and
 * 429 are the exceptions — both explicitly mean "try again".
 */
export function isRetriableStatus(status: number): boolean {
  if (status === 0) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
}
