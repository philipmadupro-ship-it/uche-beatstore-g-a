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
  isTransient: boolean;
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

/**
 * Downsample to `targetCount` values by taking the peak of each bucket, then
 * normalize into the visible `[VISUAL_PEAK_MIN, VISUAL_PEAK_MAX]` range.
 *
 * This used to sample the value at a computed fractional index and lerp
 * between its two neighbours. A kick sitting in the middle of a bucket —
 * between the two points actually sampled — got averaged toward silence as
 * often as it landed on a peak, so the browse-surface waveform read as soft
 * noise instead of a beat. `lib/cover/waveform.ts`'s `resamplePeaks` documents
 * the identical failure mode for the cover-art waveform and fixes it the same
 * way: take the max magnitude inside each bucket, never a point sample or an
 * interpolation between two of them. That module lives in a different
 * feature domain (cover-art) and isn't in scope to edit here, so the bucket
 * algorithm is reimplemented rather than imported — the two call sites should
 * not depend on each other across domains, but the fix is the same fix.
 */
export function resampleVisualPeaks(peaks: number[], targetCount: number): number[] {
  if (targetCount <= 0) return [];
  if (peaks.length === 0) return Array(targetCount).fill(0.5);

  const output: number[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    const start = (i / targetCount) * peaks.length;
    const end = ((i + 1) / targetCount) * peaks.length;
    const from = Math.floor(start);
    // At least one sample per bucket when upsampling past the source length.
    const to = Math.max(from + 1, Math.ceil(end));

    let peak = 0;
    for (let j = from; j < to && j < peaks.length; j += 1) {
      const value = Math.abs(peaks[j] ?? 0);
      if (value > peak) peak = value;
    }
    output.push(peak);
  }

  const max = Math.max(...output, 1e-6);
  return output.map((value) => VISUAL_PEAK_MIN + (value / max) * (VISUAL_PEAK_MAX - VISUAL_PEAK_MIN));
}

/**
 * Transient annotation for the compact pill waveform.
 *
 * `isTransient` is derived from actual peak heights relative to their
 * neighbours, so it carries real audio information.
 *
 * This function used to also emit `isBeat`/`isDownbeat`, a 1/4 and 1/16 grid
 * computed from `index % 4` / `index % 16` — arithmetic on the bar's position
 * in the resampled array, not on tempo, time, or anything about the audio.
 * Two bars 16 apart are only "a bar apart" if BAR_COUNT bars happen to span a
 * whole number of bars at the track's actual BPM, which isn't true in
 * general — the grid drew the same shape over a 90 BPM beat and a 174 BPM
 * one. CLAUDE.md documents the identical mistake in the cover-art waveform
 * (bands from `index % 6` / `index % 3`) and calls it out as a defect class:
 * positional arithmetic that "looked" musical while carrying none of the
 * track's actual timing.
 *
 * A real grid would need the track's BPM and the clip's duration to place
 * bar/downbeat lines at actual time positions, but the only current caller
 * (`MiniWaveform`, rendered from `PlayerBar`) has neither in scope to plumb
 * through — `PlayerBar` isn't part of this change. Rather than keep a fake
 * grid that pretends to be musical, it's removed outright; `isTransient`
 * (real, peak-derived) is the only annotation this module makes now. If a
 * true tempo-locked grid is wanted later, it belongs in a function that takes
 * `bpm` and `durationSeconds` as inputs, not one that infers time from array
 * index.
 */
export function buildDawWaveformBars(peaks: number[]): DawWaveformBar[] {
  return peaks.map((height, index) => {
    const previous = peaks[index - 1] ?? height;
    const next = peaks[index + 1] ?? height;
    const localAverage = (previous + height + next) / 3;
    const isTransient = height >= 0.72 && height >= localAverage * 1.16;
    return {
      height,
      index,
      isTransient,
    };
  });
}

/**
 * Where to fetch a peaks sidecar from.
 *
 * Peaks live in the public R2 bucket, usually at a `pub-….r2.dev` URL. The
 * browser cannot `fetch()` those without CORS headers, so `canFetchReadableAudio`
 * rightly refuses them — and this loader used to stop there and return null.
 * With no CDN configured that was EVERY peaks URL, so the library's waveform
 * column rendered an empty box on every row while looking like a feature.
 *
 * Unreadable http(s) URLs now go through the same-origin `/api/audio` proxy,
 * which streams any source for the producer. Anywhere a producer session is
 * absent (a buyer on the store) the proxy answers 401, the loader returns
 * null, and callers fall back exactly as they did before.
 */
export function visualPeaksFetchUrl(url: string | null | undefined): string | null {
  const resolved = cdnAudioSrc(url);
  if (!resolved) return null;
  if (canFetchReadableAudio(resolved)) return resolved;
  if (/^https?:\/\//i.test(resolved)) return `/api/audio?src=${encodeURIComponent(resolved)}`;
  return null;
}

/**
 * Resolved peaks by source URL, for the life of the page.
 *
 * The proxy sends `no-store`, so without this every remount — switching list
 * to grid and back, re-sorting — refetches fifty sidecars through a function.
 * Only successes are kept: an aborted or failed load must be free to retry.
 */
const peaksCache = new Map<string, number[]>();

export async function loadVisualPeaks(url: string, signal: AbortSignal): Promise<number[] | null> {
  const fetchUrl = visualPeaksFetchUrl(url);
  if (!fetchUrl) return null;

  const cached = peaksCache.get(fetchUrl);
  if (cached) return cached;

  try {
    const response = await fetch(fetchUrl, { signal, cache: 'force-cache' });
    if (!response.ok) return null;
    const json = (await response.json()) as ClientPeaksFile;
    if (!json?.peaks?.length) return null;
    peaksCache.set(fetchUrl, json.peaks);
    return json.peaks;
  } catch {
    return null;
  }
}

/** Test seam: the cache outlives a single test otherwise. */
export function clearVisualPeaksCache(): void {
  peaksCache.clear();
}
