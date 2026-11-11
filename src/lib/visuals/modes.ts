/** Order is the switcher order: orbit and terrain first. */
export const VISUAL_MODES = ['orbit', 'terrain', 'curve'] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

export const VISUAL_MODE_LABELS: Record<VisualMode, string> = {
  orbit: 'Orbit',
  terrain: 'Terrain',
  curve: 'Curve',
};

export const VISUAL_MODE_STORAGE_KEY = 'antigravity-visual-mode';
export const DEFAULT_VISUAL_MODE: VisualMode = 'orbit';

export function parseVisualMode(value: unknown): VisualMode {
  return typeof value === 'string' && (VISUAL_MODES as readonly string[]).includes(value)
    ? (value as VisualMode)
    : DEFAULT_VISUAL_MODE;
}

/** Next/previous mode for arrow-key roving in the radiogroup (wraps). */
export function stepMode(current: VisualMode, delta: 1 | -1): VisualMode {
  const i = VISUAL_MODES.indexOf(current);
  return VISUAL_MODES[(i + delta + VISUAL_MODES.length) % VISUAL_MODES.length];
}
