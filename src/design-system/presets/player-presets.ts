import { deRocheWavePalette } from '../foundations/colors';

export const waveformPalettes = {
  'de-roche-spectrum': deRocheWavePalette,
} as const;

export const playerThemePresets = {
  'de-roche-cover-spectral-mask': {
    waveformMode: 'spectral-mask',
    waveformPalette: 'de-roche-spectrum',
    waveformOpacity: 0.72,
    waveformSaturation: 0.78,
    waveformLineWidth: 1,
    waveformSmoothing: 0.35,
    artworkBlendMode: 'screen',
    progressTreatment: 'reveal',
    playheadStyle: 'technical-line',
    showBeatGrid: false,
    showCueMarkers: true,
    artworkMotionStrength: 0.08,
    reducedMotionFallback: 'static-peaks',
  },
  'de-roche-cover-scanline': {
    waveformMode: 'scanline-playhead',
    waveformPalette: 'de-roche-spectrum',
    waveformOpacity: 0.62,
    waveformSaturation: 0.7,
    waveformLineWidth: 1,
    waveformSmoothing: 0.42,
    artworkBlendMode: 'soft-light',
    progressTreatment: 'playhead-emphasis',
    playheadStyle: 'irregular-technical-line',
    showBeatGrid: false,
    showCueMarkers: false,
    artworkMotionStrength: 0.03,
    reducedMotionFallback: 'static-playhead',
  },
} as const;

export type PlayerThemePresetId = keyof typeof playerThemePresets;

export function getPlayerThemePreset(id: PlayerThemePresetId = 'de-roche-cover-spectral-mask') {
  return playerThemePresets[id];
}
