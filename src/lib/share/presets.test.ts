import { describe, expect, it } from 'vitest';
import { SHARE_PRESETS, SHARE_PRESET_IDS, asSharePresetId, presetFilename, safeBox } from './presets';

describe('share presets', () => {
  it('has the three platform sizes', () => {
    expect(SHARE_PRESETS.square).toMatchObject({ width: 1080, height: 1080 });
    expect(SHARE_PRESETS.story).toMatchObject({ width: 1080, height: 1920 });
    expect(SHARE_PRESETS.og).toMatchObject({ width: 1200, height: 630 });
  });
  it('keeps the safe box inside the artboard with room on every side', () => {
    for (const id of SHARE_PRESET_IDS) {
      const p = SHARE_PRESETS[id];
      const b = safeBox(p);
      expect(b.x).toBeGreaterThan(0);
      expect(b.y).toBeGreaterThan(0);
      expect(b.x + b.width).toBeLessThan(p.width);
      expect(b.y + b.height).toBeLessThan(p.height);
    }
  });
  it('story reserves more top and bottom than the square', () => {
    expect(SHARE_PRESETS.story.safe.top).toBeGreaterThan(SHARE_PRESETS.square.safe.top);
  });
  it('falls back to story and builds safe filenames', () => {
    expect(asSharePresetId('nope')).toBe('story');
    expect(asSharePresetId('og')).toBe('og');
    expect(presetFilename('Night Shift / 140!', SHARE_PRESETS.og)).toBe('night-shift-140-og-1200x630.png');
    expect(presetFilename('***', SHARE_PRESETS.square)).toBe('share-square-1080x1080.png');
  });
});
