/**
 * Volume and mute for the persistent player, kept as two independent values.
 *
 * Mute used to be encoded as `volume === 0`, with the pre-mute level stashed
 * in a component ref. That made mute and volume one value: muting destroyed
 * the level, the slider jumped to zero, and because only `volume` was
 * persisted a refresh while muted forgot the level entirely — unmuting then
 * came back at the 0.8 default rather than where the listener had it.
 *
 * Now `volume` is the listener's chosen level and `muted` is a separate flag.
 * Neither touches playback (`isPlaying`, `currentTrack`, `progress`), and
 * every engine derives what it actually outputs from `outputVolume`.
 */

export const DEFAULT_VOLUME = 0.8;
/** Keyboard ↑/↓ step. */
export const VOLUME_STEP = 0.1;

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, v));
}

export interface VolumeState {
  volume: number;
  muted: boolean;
}

/**
 * Setting a level. Raising it above zero while muted unmutes — a listener
 * dragging the slider or pressing ↑ wants to hear the result. Setting zero
 * leaves the mute flag alone.
 */
export function applyVolume(state: VolumeState, next: number): VolumeState {
  const volume = clampVolume(next);
  return { volume, muted: volume > 0 ? false : state.muted };
}

/**
 * Toggling mute keeps the level. Unmuting a level of zero (the slider was
 * dragged to the bottom) would still be silent, so it restores the default.
 */
export function toggleMuted(state: VolumeState): VolumeState {
  if (state.muted) {
    return { muted: false, volume: state.volume > 0 ? state.volume : DEFAULT_VOLUME };
  }
  return { muted: true, volume: state.volume };
}

/** What the listener hears as silent: muted, or a level of zero. */
export function isSilent(state: VolumeState): boolean {
  return state.muted || state.volume <= 0;
}

/** The gain an engine should apply: 0 when muted, else level × duck × normalisation. */
export function outputVolume(
  state: VolumeState,
  duckGain = 1,
  normGain = 1,
): number {
  if (state.muted) return 0;
  return clampVolume(state.volume * duckGain * normGain);
}

/**
 * Persisted state from before `muted` existed stored a mute as `volume: 0`.
 * Read that back as muted at the default level, so the first unmute after the
 * upgrade is audible instead of silently restoring zero.
 */
export function migratePersistedVolume(persisted: unknown): VolumeState {
  const p = (persisted ?? {}) as { volume?: unknown; muted?: unknown };
  const raw = typeof p.volume === 'number' ? clampVolume(p.volume) : DEFAULT_VOLUME;
  if (typeof p.muted === 'boolean') return { volume: raw, muted: p.muted };
  if (raw === 0) return { volume: DEFAULT_VOLUME, muted: true };
  return { volume: raw, muted: false };
}
