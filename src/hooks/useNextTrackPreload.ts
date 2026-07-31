'use client';

/**
 * Warms the next track's audio while the current one plays, for near-gapless
 * advance.
 *
 * The audible gap between tracks is the next file's network fetch. Pre-warming
 * the browser HTTP cache (audio + peaks sidecar) means `load()` resolves
 * instantly on advance.
 *
 * Deliberately skipped when shuffling (the next track is unpredictable, so any
 * guess is usually wasted data) and when paused (never burn a listener's data
 * in the background for a track they may never reach).
 */

import { useEffect } from 'react';
import { canFetchReadableAudio, cdnAudioSrc } from '@/lib/audio/cdn';
import type { Track } from '@/lib/types';

interface Options {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
}

export function useNextTrackPreload({ currentTrack, queue, isPlaying, shuffle, repeat }: Options) {
  useEffect(() => {
    if (!isPlaying || shuffle || !currentTrack || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    const upcoming = queue[idx + 1] ?? (repeat === 'all' ? queue[0] : null);
    if (!upcoming?.audio_url || upcoming.id === currentTrack.id) return;

    const ctrl = new AbortController();
    // Warm the SAME direct R2/CDN URL the engine will request (not the proxy).
    // Only for direct http(s) previews — a proxy-bound r2:// master would pull
    // the full ~80MB file through the origin, burning mobile data and choking
    // the active stream's bandwidth.
    const warmSrc = cdnAudioSrc(upcoming.audio_url);
    if (/^https?:\/\//i.test(warmSrc) && canFetchReadableAudio(warmSrc)) {
      // Low priority so it never competes with the current track's stream.
      fetch(warmSrc, { signal: ctrl.signal, priority: 'low' as RequestPriority }).catch(() => {});
    }
    if (upcoming.peaks_url) {
      fetch(upcoming.peaks_url, { signal: ctrl.signal, cache: 'force-cache' }).catch(() => {});
    }
    return () => ctrl.abort();
  }, [currentTrack, isPlaying, shuffle, repeat, queue]);
}
