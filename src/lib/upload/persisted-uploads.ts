/**
 * Validation for upload state restored from localStorage.
 *
 * WHY THIS IS DEFENSIVE RATHER THAN A CAST.
 *
 * `hydrate()` used to do `JSON.parse(raw) as PersistedItem[]` and then read
 * fields straight off each entry — `p.completedPartNumbers.length`. localStorage
 * is not a trusted source: its contents were written by whatever version of the
 * app the user last ran, can be edited by hand, can be truncated by a
 * quota-exceeded write, and outlive any number of deploys. A single entry
 * missing one field threw `Cannot read properties of undefined (reading
 * 'length')`.
 *
 * That throw did not merely break the uploads tray. `UploadsTray` is mounted in
 * `DashboardGroupLayout`, so the exception propagated out of the layout and
 * took down EVERY dashboard route — library, projects, sales, settings. And
 * because the bad entry stayed in localStorage, it reproduced on every reload:
 * an unrecoverable dashboard for anyone who could not think to clear their site
 * data by hand. Reproduced in-browser before writing this.
 *
 * So: parse defensively, salvage what is coherent, drop what is not, and never
 * throw. A dropped upload row costs the user a resume button. A thrown one
 * costs them the whole dashboard.
 */

import type { UploadStatus } from './manager';
import { bytesFromParts } from './progress';

/** One upload as stored in localStorage. */
export interface PersistedItem {
  id: string;
  sessionId: string | null;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  contentType: string;
  partSize: number;
  totalParts: number;
  completedPartNumbers: number[];
  type: string;
  projectId: string | null;
  replaceTrackId: string | null;
  status: UploadStatus;
  startedAt: number;
}

const VALID_STATUSES: readonly UploadStatus[] = [
  'queued', 'preparing', 'uploading', 'finalizing',
  'success', 'error', 'paused', 'interrupted', 'aborted',
];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Part numbers, keeping only finite positive integers. */
function partNumbers(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
}

function status(v: unknown): UploadStatus {
  return VALID_STATUSES.includes(v as UploadStatus) ? (v as UploadStatus) : 'interrupted';
}

/**
 * Normalise one raw entry, or null if it is too broken to be useful.
 *
 * `id` and `fileName` are the only genuinely required fields — without an id
 * there is nothing to key the row on, and without a name there is nothing to
 * show or match a re-picked file against. Everything else gets a sane default,
 * because a row with a missing byte count is still a row the user can resume.
 */
export function normalisePersistedItem(raw: unknown): PersistedItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id = str(r.id);
  const fileName = str(r.fileName);
  if (!id || !fileName) return null;

  return {
    id,
    sessionId: nullableStr(r.sessionId),
    fileName,
    fileSize: Math.max(0, num(r.fileSize, 0)),
    fileLastModified: num(r.fileLastModified, 0),
    contentType: str(r.contentType, 'application/octet-stream'),
    // Never 0: partSize is used as a divisor and multiplier downstream.
    partSize: Math.max(1, num(r.partSize, 1)),
    totalParts: Math.max(0, num(r.totalParts, 0)),
    completedPartNumbers: partNumbers(r.completedPartNumbers),
    type: str(r.type, 'instrumental'),
    projectId: nullableStr(r.projectId),
    replaceTrackId: nullableStr(r.replaceTrackId),
    status: status(r.status),
    startedAt: num(r.startedAt, Date.now()),
  };
}

/**
 * Parse the whole localStorage payload. Always returns an array, never throws,
 * whatever is in there — including `null`, an object, a bare string, or invalid
 * JSON left by another tool.
 */
export function parsePersistedUploads(raw: string | null | undefined): PersistedItem[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: PersistedItem[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const item = normalisePersistedItem(entry);
    // Duplicate ids would collide in the uploads map and render twice.
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/**
 * Bytes already uploaded, inferred from completed parts.
 *
 * Capped at `fileSize` so a corrupted part list cannot produce a progress bar
 * reading over 100%, and aware that the final part is short — see
 * `bytesFromParts`, which owns the arithmetic for both this and the live path.
 */
export function bytesFromCompletedParts(item: PersistedItem): number {
  return bytesFromParts({
    completedPartNumbers: item.completedPartNumbers,
    partSize: item.partSize,
    totalParts: item.totalParts,
    fileSize: item.fileSize,
  });
}
