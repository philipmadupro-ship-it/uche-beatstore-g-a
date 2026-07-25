import { describe, expect, it } from 'vitest';
import { designSystemExportFilename, formatDesignSystemLabExport } from './lab-export';

describe('design system lab export', () => {
  it('formats config as stable pretty JSON with trailing newline', () => {
    expect(formatDesignSystemLabExport({
      theme: 'de-roche-night',
      accent: 'theme',
      motion: 'normal',
      playerPreset: 'de-roche-cover-spectral-mask',
      cssVars: { '--brand-primary': '#C4B49C' },
      player: { waveformOpacity: 0.72, showCueMarkers: true },
    })).toBe([
      '{',
      '  "theme": "de-roche-night",',
      '  "accent": "theme",',
      '  "motion": "normal",',
      '  "playerPreset": "de-roche-cover-spectral-mask",',
      '  "cssVars": {',
      '    "--brand-primary": "#C4B49C"',
      '  },',
      '  "player": {',
      '    "waveformOpacity": 0.72,',
      '    "showCueMarkers": true',
      '  }',
      '}',
      '',
    ].join('\n'));
  });

  it('creates safe filenames from selected config', () => {
    expect(designSystemExportFilename({
      theme: 'de-roche-night',
      accent: 'luxury-beige',
      playerPreset: 'de-roche-cover-spectral-mask',
    })).toBe('beatstor-design-de-roche-night-luxury-beige-de-roche-cover-spectral-mask.json');
  });

  it('includes cover-art source config when present', () => {
    const output = formatDesignSystemLabExport({
      theme: 'de-roche-night',
      accent: 'theme',
      motion: 'normal',
      playerPreset: 'de-roche-cover-scanline',
      cssVars: {},
      player: {},
      coverArt: {
        templateId: 'dark-listening-room',
        exportPresetId: 'square-cover',
        title: 'Midnight Cartel',
        producerName: 'Uche',
        bpm: 144,
        musicalKey: 'F minor',
        colorVariation: 'theme',
        waveformVariation: 'low-scanline',
        preserveSource: true,
      },
    });

    expect(output).toContain('"coverArt"');
    expect(output).toContain('"templateId": "dark-listening-room"');
    expect(output).toContain('"preserveSource": true');
  });
});
