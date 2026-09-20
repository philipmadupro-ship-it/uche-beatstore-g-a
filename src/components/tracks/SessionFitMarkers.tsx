'use client';

import { ArrowLeftRight, Check } from 'lucide-react';

import { useSessionContext } from '@/hooks/useSessionContext';
import { keyFit, tempoFit, type MatchableTrack } from '@/lib/audio/session-match';

/**
 * Whether this track fits the producer's current session, shown on the row.
 *
 * Marking rather than filtering is the point: a session tempo says what fits
 * and leaves the rest of the catalogue visible, so setting one costs nothing.
 *
 * Every marker is an icon or a word plus a title and an accessible label —
 * never colour alone, which would carry no meaning for a third of the reasons
 * anyone looks at a catalogue in a hurry.
 */

/** Musical key gets the warm accent; tempo stays white at alpha. */
const KEY_ACCENT = '#c8a47a';

const KEY_FIT_COPY = {
  same: { label: 'Same key as your session', icon: 'check' },
  relative: { label: 'Relative major/minor of your session key', icon: 'swap' },
  neighbour: { label: 'One step from your session key — mixes cleanly', icon: 'swap' },
} as const;

const TEMPO_FIT_COPY = {
  same: { label: 'Same tempo as your session', text: null },
  half: { label: 'Half-time of your session tempo', text: '½×' },
  double: { label: 'Double-time of your session tempo', text: '2×' },
} as const;

export function SessionFitMarkers({ track }: { track: MatchableTrack }) {
  // Selected field by field so a row only re-renders when a value it actually
  // reads changes. Nothing here is memoised — `TrackCard` is not either — and
  // a library page renders fifty of these.
  const bpm = useSessionContext((s) => s.bpm);
  const key = useSessionContext((s) => s.key);
  const scale = useSessionContext((s) => s.scale);
  const tolerance = useSessionContext((s) => s.matchTolerance);

  const session = { bpm, key, scale };
  const fitKey = keyFit(session, track);
  const fitTempo = tempoFit(session, track, tolerance);
  if (!fitKey && !fitTempo) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {fitKey ? (
        <span
          title={KEY_FIT_COPY[fitKey].label}
          aria-label={KEY_FIT_COPY[fitKey].label}
          style={{ color: KEY_ACCENT }}
          className="flex items-center"
        >
          {KEY_FIT_COPY[fitKey].icon === 'check' ? (
            <Check size={11} aria-hidden />
          ) : (
            <ArrowLeftRight size={11} aria-hidden />
          )}
        </span>
      ) : null}

      {fitTempo ? (
        <span
          title={TEMPO_FIT_COPY[fitTempo].label}
          aria-label={TEMPO_FIT_COPY[fitTempo].label}
          className="flex items-center text-white/70"
        >
          {TEMPO_FIT_COPY[fitTempo].text ?? <Check size={11} aria-hidden />}
        </span>
      ) : null}
    </span>
  );
}
