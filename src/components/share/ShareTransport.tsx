'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** The track the page's engine is on. */
export interface ShareTransportTrack {
  id: string;
  title: string;
  type?: string | null;
  cover_url?: string | null;
  peaks_url?: string | null;
  audio_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

/**
 * The share page's ONE audio engine, as every view of it sees it.
 *
 * Both share pages run a single WaveSurfer / audio element. The track rows'
 * waveforms, the bottom transport bar and the spinning vinyl are views and
 * remotes of that engine: they read `currentTime` from here (one source, so
 * they cannot disagree) and act through these callbacks (so play, seek and
 * track change from any of them move all of them). Nothing here creates audio.
 */
export interface ShareTransport {
  /** The track on the engine (the first one before anything has played). */
  track: ShareTransportTrack | null;
  index: number;
  count: number;
  currentTime: number;
  duration: number;
  /** What the audio element is actually doing — not what was requested. */
  playing: boolean;
  /** Play was requested but the element is not playing yet (loading or stalled). */
  buffering: boolean;
  toggle: () => void;
  prev: () => void;
  next: () => void;
  /** Seek the current track to a 0..1 fraction. */
  seekToFraction: (fraction: number) => void;
  /** Select a track and start it at a 0..1 fraction (a click on an idle row's waveform). */
  playAt: (trackId: string, fraction: number) => void;
}

const ShareTransportContext = createContext<ShareTransport | null>(null);

export function ShareTransportProvider({ value, children }: { value: ShareTransport; children: ReactNode }) {
  return <ShareTransportContext.Provider value={value}>{children}</ShareTransportContext.Provider>;
}

export function useShareTransport(): ShareTransport | null {
  return useContext(ShareTransportContext);
}
