import { describe, expect, it } from 'vitest';
import { getArtworkSafetyTreatment, parseRgbColor, relativeLuminance } from './artwork-safety';

describe('artwork safety treatment', () => {
  it('parses rgb strings', () => {
    expect(parseRgbColor('rgb(12, 34, 56)')).toEqual([12, 34, 56]);
    expect(parseRgbColor('rgba(200, 180, 120, 0.7)')).toEqual([200, 180, 120]);
    expect(parseRgbColor('#fff')).toBeNull();
  });

  it('computes relative luminance ordering', () => {
    expect(relativeLuminance([10, 10, 10])).toBeLessThan(relativeLuminance([220, 220, 220]));
  });

  it('chooses stronger protection for dark and bright covers', () => {
    const dark = getArtworkSafetyTreatment('rgb(12, 12, 10)');
    const bright = getArtworkSafetyTreatment('rgb(235, 228, 210)');
    const mid = getArtworkSafetyTreatment('rgb(128, 118, 100)');

    expect(dark.tone).toBe('dark');
    expect(bright.tone).toBe('bright');
    expect(mid.tone).toBe('mid');
    expect(bright.overlayOpacity).toBeGreaterThan(mid.overlayOpacity);
    expect(dark.waveformOpacity).toBeGreaterThan(bright.waveformOpacity);
  });

  it('returns a conservative fallback for missing colours', () => {
    expect(getArtworkSafetyTreatment(null).tone).toBe('unknown');
  });
});
