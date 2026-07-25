import { describe, expect, it } from 'vitest';
import { getBeatstorThemeCssVars, beatstorThemes } from './index';
import { playerThemePresets } from '../presets/player-presets';

describe('De Roche design-system foundation', () => {
  it('defines night and archive themes with semantic CSS variables', () => {
    expect(Object.keys(beatstorThemes)).toEqual(['de-roche-night', 'de-roche-archive']);

    const nightVars = getBeatstorThemeCssVars('de-roche-night');
    expect(nightVars['--background-primary']).toBe('#0B0B0A');
    expect(nightVars['--brand-primary']).toBe('#C4B49C');
    expect(nightVars['--wave-high']).toBe('#3C78A8');

    const archiveVars = getBeatstorThemeCssVars('de-roche-archive');
    expect(archiveVars['--background-primary']).toBe('#EEE8DD');
    expect(archiveVars['--text-primary']).toBe('#11110F');
  });

  it('keeps spectral colour inside player presets instead of generic UI accents', () => {
    const preset = playerThemePresets['de-roche-cover-spectral-mask'];
    expect(preset.waveformPalette).toBe('de-roche-spectrum');
    expect(preset.reducedMotionFallback).toBe('static-peaks');
    expect(preset.artworkMotionStrength).toBeLessThan(0.1);
  });
});
