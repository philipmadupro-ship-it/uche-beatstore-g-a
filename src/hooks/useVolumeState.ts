'use client';

import { useCallback, useState } from 'react';
import {
  DEFAULT_VOLUME,
  applyVolume,
  isSilent,
  outputVolume,
  toggleMuted,
  type VolumeState,
} from '@/lib/audio/player-volume';

/**
 * Page-local volume + mute for players that own their own engine (the two
 * share pages), following the same rules as the persistent player's store
 * (`lib/audio/player-volume.ts`). Not persisted: a share recipient's level
 * stays on the page they opened.
 *
 * One state object, not two `useState`s — the rules move both fields
 * together (raising the level unmutes; unmuting zero restores the default).
 */
export function useVolumeState(initial: Partial<VolumeState> = {}) {
  const [state, setState] = useState<VolumeState>(() => ({
    volume: initial.volume ?? DEFAULT_VOLUME,
    muted: initial.muted ?? false,
  }));

  const setVolume = useCallback((v: number) => setState((s) => applyVolume(s, v)), []);
  const toggleMute = useCallback(() => setState((s) => toggleMuted(s)), []);

  return {
    volume: state.volume,
    muted: state.muted,
    /** What the engine should play at. */
    output: outputVolume(state),
    /** Muted, or a level of zero — what the icon shows. */
    silent: isSilent(state),
    setVolume,
    toggleMute,
  };
}
