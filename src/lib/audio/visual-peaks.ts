import { canFetchReadableAudio, cdnAudioSrc } from '@/lib/audio/cdn';

export interface ClientPeaksFile {
  version: number;
  peaks: number[];
  duration: number;
  length: number;
}

export const VISUAL_PEAK_MIN = 0.08;
export const VISUAL_PEAK_MAX = 1;

export interface DawWaveformBar {
  height: number;
  index: number;
  isBeat: boolean;
  isDownbeat: boolean;
  isTransient: boolean;
  band: 'low' | 'lowMid' | 'mid' | 'highMid' | 'high';
}

export function seedFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticVisualPeaks(trackId: string, count: number): number[] {
  const random = mulberry32(seedFromString(trackId));
  return Array.from({ length: count }, (_, index) => {
    const position = index / count;
    const envelope =
      position < 0.2
        ? 0.3 + 0.7 * (position / 0.2)
        : position > 0.85
          ? 0.3 + 0.7 * ((1 - position) / 0.15)
          : 1;
    return Math.max(VISUAL_PEAK_MIN, Math.min(VISUAL_PEAK_MAX, (random() * 0.7 + 0.3) * envelope));
  });
}

export function resampleVisualPeaks(peaks: number[], targetCount: number): number[] {
  if (targetCount <= 0) return [];
  if (peaks.length === 0) return Array(targetCount).fill(0.5);

  const output: number[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    const sourceIndex = targetCount === 1 ? 0 : (i / (targetCount - 1)) * (peaks.length - 1);
    const low = Math.floor(sourceIndex);
    const high = Math.min(low + 1, peaks.length - 1);
    const t = sourceIndex - low;
    const raw = Math.abs(peaks[low] ?? 0) * (1 - t) + Math.abs(peaks[high] ?? 0) * t;
    output.push(raw);
  }

  const max = Math.max(...output, 1e-6);
  return output.map((value) => VISUAL_PEAK_MIN + (value / max) * (VISUAL_PEAK_MAX - VISUAL_PEAK_MIN));
}

export function buildDawWaveformBars(peaks: number[]): DawWaveformBar[] {
  return peaks.map((height, index) => {
    const previous = peaks[index - 1] ?? height;
    const next = peaks[index + 1] ?? height;
    const localAverage = (previous + height + next) / 3;
    const isBeat = index % 4 === 0;
    const isDownbeat = index % 16 === 0;
    const isTransient = height >= 0.72 && height >= localAverage * 1.16;
    const bandIndex = index % 5;
    const band = bandIndex === 0
      ? 'low'
      : bandIndex === 1
        ? 'lowMid'
        : bandIndex === 2
          ? 'mid'
          : bandIndex === 3
            ? 'highMid'
            : 'high';
    return {
      height,
      index,
      isBeat,
      isDownbeat,
      isTransient,
      band,
    };
  });
}

export async function loadVisualPeaks(url: string, signal: AbortSignal): Promise<number[] | null> {
  const readableUrl = cdnAudioSrc(url);
  if (!canFetchReadableAudio(readableUrl)) return null;

  try {
    const response = await fetch(readableUrl, { signal, cache: 'force-cache' });
    if (!response.ok) return null;
    const json = (await response.json()) as ClientPeaksFile;
    if (!json?.peaks?.length) return null;
    return json.peaks;
  } catch {
    return null;
  }
}
