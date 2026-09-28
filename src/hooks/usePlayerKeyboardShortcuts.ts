'use client';

/**
 * Global transport keyboard shortcuts.
 *
 * Space play/pause · ←/→ seek 5s · ↑/↓ volume · n/p next/prev · m mute.
 *
 * Ignored while the user is typing in a field or a contenteditable, and when a
 * modifier is held — otherwise Space would hijack every search box on the page
 * and ⌘← would stop meaning "back".
 */

import { useEffect } from 'react';
import type { Track } from '@/lib/types';
import { VOLUME_STEP } from '@/lib/audio/player-volume';

interface Options {
  currentTrack: Track | null;
  progress: number;
  volume: number;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (fraction: number) => void;
  setVolume: (v: number) => void;
  /** Flips the store's mute flag — the same action as the mute button. */
  toggleMute: () => void;
}

export function usePlayerKeyboardShortcuts({
  currentTrack, progress, volume, togglePlay, next, prev, seekTo, setVolume, toggleMute,
}: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A handler closer to the target already claimed this key. That is how a
      // track list takes ↑/↓ for moving between rows while volume keeps them
      // everywhere else: the list listens on its own element, which the event
      // reaches before bubbling up to this window listener, and calls
      // preventDefault() on the keys it handles. First to claim a key wins.
      // Without this check both would act — a single ↓ would move the row AND
      // drop the volume.
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const dur = currentTrack?.duration_seconds || 0;
      const canAttemptPlayback = Boolean(currentTrack?.audio_url);

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (canAttemptPlayback) togglePlay();
          break;
        case 'ArrowRight': if (dur > 0) { e.preventDefault(); seekTo(Math.min(1, progress + 5 / dur)); } break;
        case 'ArrowLeft':  if (dur > 0) { e.preventDefault(); seekTo(Math.max(0, progress - 5 / dur)); } break;
        // Steps the kept level; ↑ while muted also unmutes (see applyVolume).
        case 'ArrowUp':   e.preventDefault(); setVolume(Math.min(1, volume + VOLUME_STEP)); break;
        case 'ArrowDown': e.preventDefault(); setVolume(Math.max(0, volume - VOLUME_STEP)); break;
        case 'n': case 'N': next(); break;
        case 'p': case 'P': prev(); break;
        case 'm': case 'M': toggleMute(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentTrack, progress, volume, togglePlay, next, prev, seekTo, setVolume, toggleMute]);
}
