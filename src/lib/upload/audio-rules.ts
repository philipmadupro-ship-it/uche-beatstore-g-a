/**
 * What a chunked audio upload accepts and how it is cut into parts. Shared by
 * the producer's `/api/upload/init` and the org's `/api/org/[orgId]/upload/init`
 * (LABEL-14) so the two cannot drift. Moved verbatim from the producer route.
 */
import { DEFAULT_PART_SIZE, MAX_PARTS, MIN_PART_SIZE } from '@/lib/storage/multipart';

export const MAX_BYTES = 500 * 1024 * 1024; // raised cap for chunked path
export const ALLOWED_EXT = ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg'];

export function detectContentType(ext: string, fallback: string): string {
  switch (ext) {
    case 'mp3':  return 'audio/mpeg';
    case 'wav':  return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'aif':
    case 'aiff': return 'audio/aiff';
    case 'm4a':  return 'audio/mp4';
    case 'ogg':  return 'audio/ogg';
    default:     return fallback || 'application/octet-stream';
  }
}

export function pickPartSize(fileSize: number): number {
  // Stay above the 5 MiB R2 minimum and below the 10k part limit
  const want = Math.max(MIN_PART_SIZE, DEFAULT_PART_SIZE);
  const minNeeded = Math.ceil(fileSize / MAX_PARTS);
  return Math.max(want, minNeeded);
}

/** 400 / 413 / 415 for a file the upload path refuses, else null. */
export function audioUploadProblem(fileName: string, fileSize: number): { status: 400 | 413 | 415; error: string } | null {
  if (!fileName || typeof fileSize !== 'number' || fileSize <= 0) return { status: 400, error: 'fileName and fileSize required' };
  if (fileSize > MAX_BYTES) {
    return { status: 413, error: `File too large (${Math.round(fileSize / 1024 / 1024)}MB, max ${MAX_BYTES / 1024 / 1024}MB)` };
  }
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return { status: 415, error: `Unsupported extension ".${ext}". Supported: ${ALLOWED_EXT.join(', ')}` };
  }
  return null;
}
