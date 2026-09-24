/**
 * Maths for the music-reactive hero backdrop, kept pure so it is testable and
 * cannot drift between the heroes that use it.
 *
 * Input is the player's already-normalised level/bass (0..1). Output is a
 * small set of CSS-ready numbers. The response is deliberately gentle — a hero
 * that pulses hard behind a page title is a distraction, not a feature — and
 * collapses to a fixed resting state when nothing is playing.
 */
export interface BackdropFrame {
  /** Scale of the low (bass) glow. */
  bassScale: number;
  /** Opacity of the low glow. */
  bassOpacity: number;
  /** Opacity of the high (level) glow. */
  levelOpacity: number;
}

export const RESTING_FRAME: BackdropFrame = { bassScale: 1, bassOpacity: 0.22, levelOpacity: 0.12 };

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function backdropFrame(level: number, bass: number, playing: boolean): BackdropFrame {
  if (!playing) return RESTING_FRAME;
  const l = clamp01(level);
  const b = clamp01(bass);
  return {
    bassScale: 1 + b * 0.18,
    bassOpacity: 0.22 + b * 0.33,
    levelOpacity: 0.12 + l * 0.28,
  };
}

/** Exponential smoothing so a transient reads as a swell, not a flicker. */
export function smooth(prev: number, next: number, amount = 0.25): number {
  return prev + (next - prev) * clamp01(amount);
}
