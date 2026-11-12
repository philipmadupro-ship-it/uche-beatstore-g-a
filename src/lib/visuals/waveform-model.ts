/**
 * The deep, pure analysis behind the DAW-style waveform: one fixed-rate column
 * series for the whole mix and for each of three bands, built by PEAK.
 *
 *  - `all` / `low` / `mid` / `high` are the MAX of |sample| in each column
 *    (peak, never RMS or an average, so a kick or a hat survives).
 *  - Values are Uint8, normalised against the WHOLE track's loudest `all`
 *    column: one global scale, never per column, so there are no seams.
 *  - The bands are 4th-order (two cascaded 2nd-order sections, Q 0.7071) with
 *    the crossovers from `band-filter.ts` (250 Hz and 4 kHz).
 *  - Nothing is point-sampled or interpolated here.
 */

import { filterBand } from '@/lib/audio/band-filter';

export { CROSSOVER_HIGH_HZ, CROSSOVER_LOW_HZ } from '@/lib/audio/band-filter';

export const DEFAULT_COLUMNS_PER_SECOND = 441;

export interface WaveformModel {
  all: Uint8Array;
  low: Uint8Array;
  mid: Uint8Array;
  high: Uint8Array;
  columnsPerSecond: number;
  /** Loudest absolute sample of the mix (linear), the scale `all` was normalised to. */
  peak: number;
}

/** Peak of |samples| per column into `out` (Float32, caller-sized). */
function columnPeaks(samples: Float32Array, samplesPerColumn: number, out: Float32Array) {
  const n = out.length;
  for (let c = 0; c < n; c += 1) {
    const start = Math.floor(c * samplesPerColumn);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((c + 1) * samplesPerColumn)));
    let p = 0;
    for (let i = start; i < end; i += 1) {
      const v = samples[i] < 0 ? -samples[i] : samples[i];
      if (v > p) p = v;
    }
    out[c] = p;
  }
}

export function buildWaveformModel(
  mono: Float32Array,
  sampleRate: number,
  columnsPerSecond: number = DEFAULT_COLUMNS_PER_SECOND,
): WaveformModel {
  const columns = Math.max(0, Math.ceil((mono.length / sampleRate) * columnsPerSecond));
  const empty = (): Uint8Array => new Uint8Array(columns);
  if (columns === 0 || mono.length === 0) {
    return { all: empty(), low: empty(), mid: empty(), high: empty(), columnsPerSecond, peak: 0 };
  }
  const per = mono.length / columns;

  const allF = new Float32Array(columns);
  columnPeaks(mono, per, allF);
  let peak = 0;
  for (let c = 0; c < columns; c += 1) if (allF[c] > peak) peak = allF[c];

  // Two scratch buffers serve all three bands (a 3-minute mix is millions of samples).
  const scratch = new Float32Array(mono.length);
  const filtered = new Float32Array(mono.length);
  const bandF = new Float32Array(columns);
  const quantise = (src: Float32Array): Uint8Array => {
    const out = new Uint8Array(columns);
    if (peak <= 0) return out;
    const k = 255 / peak;
    for (let c = 0; c < columns; c += 1) {
      const v = Math.round(src[c] * k);
      out[c] = v > 255 ? 255 : v;
    }
    return out;
  };
  const band = (name: 'low' | 'mid' | 'high'): Uint8Array => {
    filterBand(name, mono, scratch, filtered, sampleRate);
    columnPeaks(filtered, per, bandF);
    return quantise(bandF);
  };

  return {
    all: quantise(allF),
    low: band('low'),
    mid: band('mid'),
    high: band('high'),
    columnsPerSecond,
    peak,
  };
}

export type AnalysisSource = 'analysis' | 'sidecar';

/**
 * Cache identity for an analysis. It names the track, the exact audio file, the
 * SOURCE (full decode vs the 512-slice server sidecar) and the resolution, so a
 * coarse sidecar is never served as — or stretched into — a full analysis.
 */
export function waveformCacheKey(
  trackId: string,
  audioUrl: string,
  source: AnalysisSource,
  resolution: number,
): string {
  return `${trackId}\u0000${audioUrl}\u0000${source}\u0000${resolution}`;
}
