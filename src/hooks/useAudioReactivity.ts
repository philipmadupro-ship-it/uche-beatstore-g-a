'use client';

/**
 * Playhead-sampled loudness and bass, for anything that reacts to the audio.
 *
 * Exists because this exact sequence — run the spectral analysis, take the
 * track's own loudness range, sample level and bass at the playhead — was
 * written out longhand in every component that needed it. The duplication was
 * not harmless: all three copies mapped dB with a fixed `(db + 45) / 45`
 * window, which compressed real material into ~7% of the output range and made
 * the reactive art look static. Fixing it meant finding and editing three
 * places, and one of them was buried in a 600-line component.
 *
 * Per CLAUDE.md rule 4, the maths itself lives in `lib/audio/spectral-peaks.ts`
 * and is unit-tested there. This hook is only the wiring: analysis in, two
 * numbers out.
 */

import { useMemo } from 'react';
import { useSpectralPeaks } from '@/hooks/useSpectralPeaks';
import { loudnessRange, levelAtProgress, bassAtProgress } from '@/lib/audio/spectral-peaks';
import type { SpectralBands } from '@/lib/audio/spectral-peaks';

/** Analysis resolution. Matches what the waveform renders at. */
const SLICE_COUNT = 4096;

export interface AudioReactivity {
  /** 0..1 loudness at the playhead, normalised against this track's own range. */
  level: number;
  /** 0..1 low-band energy at the playhead, against the band's own peak. */
  bass: number;
  /** Per-slice dBFS, for callers that render a readout. */
  db: number[] | null;
  /** Per-slice band energy, for callers that colour a waveform. */
  bands: SpectralBands | null;
}

export function useAudioReactivity(
  trackId: string | null,
  audioUrl: string | null | undefined,
  progress: number,
  /**
   * When false, level and bass report 0 — for a surface showing a track that
   * is not the one actually playing, where reacting would be a lie.
   */
  enabled = true,
  /** Precomputed sidecar; skips in-browser decoding when present. */
  bandsUrl?: string | null,
): AudioReactivity {
  const { db, bands } = useSpectralPeaks(trackId, audioUrl, SLICE_COUNT, bandsUrl);

  // Memoised because it sorts the series; the per-frame lookups below are O(1).
  const range = useMemo(() => loudnessRange(db ?? []), [db]);

  const level = enabled && db?.length ? levelAtProgress(db, progress, range) : 0;
  const bass = enabled && bands?.low?.length ? bassAtProgress(bands.low, progress) : 0;

  return { level, bass, db, bands };
}
