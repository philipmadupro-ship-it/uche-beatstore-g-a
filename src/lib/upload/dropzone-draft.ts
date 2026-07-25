import type { TrackType } from '@/lib/types';

export const UPLOAD_TYPE_DRAFT_KEY = 'antigravity:upload:type:v1';

const TRACK_TYPES = new Set<TrackType>(['beat', 'instrumental', 'song', 'remix']);

export function readUploadTypeDraft(
  fallback: TrackType,
  storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
): TrackType {
  if (!storage) return fallback;
  try {
    const value = storage.getItem(UPLOAD_TYPE_DRAFT_KEY);
    return value && TRACK_TYPES.has(value as TrackType) ? (value as TrackType) : fallback;
  } catch {
    return fallback;
  }
}

export function writeUploadTypeDraft(
  type: TrackType,
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
): void {
  if (!storage || !TRACK_TYPES.has(type)) return;
  try {
    storage.setItem(UPLOAD_TYPE_DRAFT_KEY, type);
  } catch {}
}

export function uploadFileExtension(fileName: string): string {
  const ext = fileName.split('.').pop()?.trim().toLowerCase();
  return ext && ext !== fileName.toLowerCase() ? ext : 'audio';
}

export function uploadRejectionMessage(reasons: ReadonlyArray<{ code: string; message?: string }>): string {
  if (reasons.some((r) => r.code === 'file-too-large')) {
    return 'File is larger than the 500 MB upload limit.';
  }
  if (reasons.some((r) => r.code === 'file-invalid-type')) {
    return 'Unsupported audio format. Use WAV, FLAC, AIFF, MP3, M4A, or OGG.';
  }
  return reasons.find((r) => r.message)?.message || 'This file could not be queued.';
}
