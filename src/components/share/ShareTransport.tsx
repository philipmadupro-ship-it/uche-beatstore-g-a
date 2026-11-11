'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The share page's one audio engine, as the track rows need to see it.
 *
 * Both share pages run a single WaveSurfer / audio element for the track that
 * is playing. The rows draw static peaks for everything else and borrow this
 * clock for the active row's playhead and for seeking. A context rather than
 * four more props on four variants: the pages already hold these values, and
 * the variants only forward them to the list.
 */
export interface ShareTransport {
  currentTime: number;
  duration: number;
  /** Seek the playing track to a 0..1 fraction. */
  seekToFraction: (fraction: number) => void;
}

const ShareTransportContext = createContext<ShareTransport | null>(null);

export function ShareTransportProvider({ value, children }: { value: ShareTransport; children: ReactNode }) {
  return <ShareTransportContext.Provider value={value}>{children}</ShareTransportContext.Provider>;
}

export function useShareTransport(): ShareTransport | null {
  return useContext(ShareTransportContext);
}
