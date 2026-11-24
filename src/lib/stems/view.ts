/** The producer-facing shape of a stem job (AUDIO-05). Pure. */
import { failureText, type StemJobStatus } from './lifecycle';
import type { StemRowFull } from './store';

export type StemClientStatus = 'none' | 'queued' | 'processing' | 'ready' | 'failed';

/** A stored r2:// reference becomes the producer's authenticated audio proxy URL; a private ref never leaves as-is. */
export function stemPlaybackUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('/api/')) return ref;
  return `/api/audio?src=${encodeURIComponent(ref)}`;
}

export function clientStatusOf(status: StemJobStatus | string | null | undefined): StemClientStatus {
  if (status === 'pending') return 'queued';
  if (status === 'processing') return 'processing';
  if (status === 'done') return 'ready';
  if (status === 'failed') return 'failed';
  return 'none';
}

export interface StemJobView {
  status: StemClientStatus;
  error: string | null;
  attempts: number;
  stems: { vocals: string | null; drums: string | null; bass: string | null; other: string | null } | null;
}

export function toStemJobView(row: StemRowFull | null): StemJobView {
  if (!row) return { status: 'none', error: null, attempts: 0, stems: null };
  const status = clientStatusOf(row.status);
  return {
    status,
    error: status === 'failed' ? failureText(row) : null,
    attempts: row.attempts ?? 0,
    stems: status === 'ready'
      ? {
          vocals: stemPlaybackUrl(row.vocals_url),
          drums: stemPlaybackUrl(row.drums_url),
          bass: stemPlaybackUrl(row.bass_url),
          other: stemPlaybackUrl(row.other_url),
        }
      : null,
  };
}
