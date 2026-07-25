export type ArtworkTone = 'dark' | 'mid' | 'bright' | 'unknown';

export type ArtworkSafetyTreatment = {
  tone: ArtworkTone;
  overlayOpacity: number;
  waveformUnderlayOpacity: number;
  waveformOpacity: number;
  label: string;
};

const UNKNOWN_TREATMENT: ArtworkSafetyTreatment = {
  tone: 'unknown',
  overlayOpacity: 0.74,
  waveformUnderlayOpacity: 0.36,
  waveformOpacity: 0.72,
  label: 'Protected artwork',
};

export function parseRgbColor(color: string | null | undefined): [number, number, number] | null {
  if (!color) return null;
  const match = color.match(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if (![r, g, b].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) return null;
  return [r, g, b];
}

export function relativeLuminance([r, g, b]: [number, number, number]) {
  const channels = [r, g, b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function getArtworkSafetyTreatment(color: string | null | undefined): ArtworkSafetyTreatment {
  const rgb = parseRgbColor(color);
  if (!rgb) return UNKNOWN_TREATMENT;

  const luminance = relativeLuminance(rgb);
  if (luminance < 0.18) {
    return {
      tone: 'dark',
      overlayOpacity: 0.62,
      waveformUnderlayOpacity: 0.42,
      waveformOpacity: 0.84,
      label: 'Dark cover protection',
    };
  }
  if (luminance > 0.68) {
    return {
      tone: 'bright',
      overlayOpacity: 0.82,
      waveformUnderlayOpacity: 0.52,
      waveformOpacity: 0.68,
      label: 'Bright cover protection',
    };
  }
  return {
    tone: 'mid',
    overlayOpacity: 0.72,
    waveformUnderlayOpacity: 0.34,
    waveformOpacity: 0.76,
    label: 'Balanced cover protection',
  };
}
