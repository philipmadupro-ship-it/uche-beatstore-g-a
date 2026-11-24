/**
 * Output presets for share images.
 *
 * Geometry only — no drawing. A template receives a preset and lays itself out
 * inside `safe`, so one template adapts to every shape instead of being three
 * hand-built variants. The numbers are the platforms' own: 1080² feed posts,
 * 1080×1920 stories/reels (top and bottom ~14% is covered by app chrome), and
 * 1200×630 link previews.
 */

export const SHARE_PRESET_IDS = ['square', 'story', 'og'] as const;
export type SharePresetId = (typeof SHARE_PRESET_IDS)[number];
export type ShareOrientation = 'square' | 'portrait' | 'landscape';

export type SharePreset = {
  id: SharePresetId;
  label: string;
  hint: string;
  width: number;
  height: number;
  orientation: ShareOrientation;
  /** Safe zone as a fraction of the artboard on each side. */
  safe: { top: number; right: number; bottom: number; left: number };
};

export const SHARE_PRESETS: Record<SharePresetId, SharePreset> = {
  square: {
    id: 'square', label: 'Square post', hint: '1080 × 1080 · feed',
    width: 1080, height: 1080, orientation: 'square',
    safe: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 },
  },
  story: {
    id: 'story', label: 'Story 9:16', hint: '1080 × 1920 · stories, reels',
    width: 1080, height: 1920, orientation: 'portrait',
    safe: { top: 0.14, right: 0.07, bottom: 0.14, left: 0.07 },
  },
  og: {
    id: 'og', label: 'Link preview', hint: '1200 × 630 · OG',
    width: 1200, height: 630, orientation: 'landscape',
    safe: { top: 0.1, right: 0.05, bottom: 0.1, left: 0.05 },
  },
};

export function asSharePresetId(input: string | null | undefined): SharePresetId {
  return (SHARE_PRESET_IDS as readonly string[]).includes(input ?? '') ? (input as SharePresetId) : 'story';
}

export type Box = { x: number; y: number; width: number; height: number };

/** The safe zone in artboard units, rounded to whole pixels. */
export function safeBox(preset: SharePreset): Box {
  const x = Math.round(preset.width * preset.safe.left);
  const y = Math.round(preset.height * preset.safe.top);
  return {
    x,
    y,
    width: Math.round(preset.width * (1 - preset.safe.left - preset.safe.right)),
    height: Math.round(preset.height * (1 - preset.safe.top - preset.safe.bottom)),
  };
}

export function presetFilename(base: string, preset: SharePreset): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'share';
  return `${clean}-${preset.id}-${preset.width}x${preset.height}.png`;
}
