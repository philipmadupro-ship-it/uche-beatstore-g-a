'use client';

import { Repeat2 } from 'lucide-react';

import { useSessionContext } from '@/hooks/useSessionContext';
import { previewAdjustment } from '@/lib/audio/session-match';

/**
 * Says so when the preview is not playing at the track's own tempo.
 *
 * Without this the producer hears a beat time-stretched to their session and
 * has no way to tell — so a 92 BPM beat auditioned in a 140 BPM session reads
 * as a 140 BPM beat, and the catalogue they think they have is not the one
 * they have. The badge names both tempos.
 *
 * Renders nothing whenever the preview is untouched, which is the default and
 * the common case.
 */
export function SessionTempoBadge({ bpm }: { bpm: number | null | undefined }) {
  const sessionBpm = useSessionContext((s) => s.bpm);
  const previewInSession = useSessionContext((s) => s.previewInSession);

  if (!previewInSession) return null;
  const adjustment = previewAdjustment(
    { bpm: sessionBpm, key: null, scale: null },
    { bpm: bpm ?? null },
  );
  if (!adjustment) return null;

  return (
    <span
      title={`${adjustment.description}. The file itself is unchanged.`}
      className="flex items-center gap-1 text-[9px] font-mono tabular-nums text-white/60 border border-white/10 rounded px-1.5 py-0.5"
    >
      <Repeat2 size={10} aria-hidden />
      <span className="sr-only">{adjustment.description}. </span>
      <span aria-hidden>{adjustment.label}</span>
    </span>
  );
}
