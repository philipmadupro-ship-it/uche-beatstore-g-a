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
import type { RefObject } from 'react';
import type { Track } from '@/lib/types';

interface Options {
  currentTrack: Track | null;
  progress: number;
  volume: number;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (fraction: number) => void;
  setVolume: (v: number) => void;
  /** Stashes the pre-mute level so `m` can restore it. Shared with the mute button. */
  prevVolumeRef: RefObject<number>;
}

export function usePlayerKeyboardShortcuts({
  currentTrack, progress, volume, togglePlay, next, prev, seekTo, setVolume, prevVolumeRef,
}: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
        case 'ArrowUp':   e.preventDefault(); setVolume(Math.min(1, volume + 0.1)); break;
        case 'ArrowDown': e.preventDefault(); setVolume(Math.max(0, volume - 0.1)); break;
        case 'n': case 'N': next(); break;
        case 'p': case 'P': prev(); break;
        case 'm': case 'M':
          if (volume > 0) { prevVolumeRef.current = volume; setVolume(0); }
          else setVolume(prevVolumeRef.current || 0.8);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentTrack, progress, volume, togglePlay, next, prev, seekTo, setVolume, prevVolumeRef]);
}
