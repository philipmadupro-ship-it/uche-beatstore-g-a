import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDawWaveformBars,
  loadVisualPeaks,
  readablePeaksUrl,
  resampleVisualPeaks,
  syntheticVisualPeaks,
  VISUAL_PEAK_MAX,
  VISUAL_PEAK_MIN,
} from './visual-peaks';

afterEach(() => {
  delete process.env.NEXT_PUBLIC_R2_CDN_URL;
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  vi.unstubAllGlobals();
});

describe('visual waveform peaks', () => {
  it('creates deterministic synthetic fallback peaks', () => {
    expect(syntheticVisualPeaks('track-a', 8)).toEqual(syntheticVisualPeaks('track-a', 8));
    expect(syntheticVisualPeaks('track-a', 8)).not.toEqual(syntheticVisualPeaks('track-b', 8));
  });

  it('resamples real peaks into normalized visual values', () => {
    const values = resampleVisualPeaks([0, 0.25, -0.5, 1], 4);
    expect(values).toHaveLength(4);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.08);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(values.at(-1)).toBe(1);
  });

  it('handles empty source peaks', () => {
    expect(resampleVisualPeaks([], 3)).toEqual([0.5, 0.5, 0.5]);
  });

  it('does not derive a beat grid from array position', () => {
    // buildDawWaveformBars must carry no isBeat/isDownbeat field — those used
    // to be `index % 4` / `index % 16`, arithmetic on position with no
    // relationship to the track's actual tempo. Confirm the shape stays gone
    // rather than quietly creeping back in.
    const bars = buildDawWaveformBars(Array(17).fill(0.4));
    expect(bars[0]).not.toHaveProperty('isBeat');
    expect(bars[0]).not.toHaveProperty('isDownbeat');
    expect(Object.keys(bars[0]).sort()).toEqual(['height', 'index', 'isTransient']);
  });

  it('preserves a transient that sits between two resampled sample points', () => {
    // A single spike at index 2 of 5 source samples, downsampled to 2 target
    // bars. The old point-sample-and-interpolate implementation only ever
    // reads peaks[0], peaks[1] (for bar 0) and peaks[4] (for bar 1) — indices
    // (0/1)*4=0 and (1/1)*4=4 — so it never touches index 2 at all and the
    // spike vanishes into two flat, silent-looking bars. Peak-per-bucket must
    // still see it, because the spike falls inside a bucket span even though
    // it isn't one of the two points a lerp would have sampled.
    const spike = [0, 0, 1, 0, 0];
    const linearInterpolationResult = [0, 0]; // what the old algorithm produced — kept as a regression witness
    const result = resampleVisualPeaks(spike, 2);

    expect(result).not.toEqual(
      linearInterpolationResult.map(() => VISUAL_PEAK_MIN),
    );
    expect(result[0]).toBeCloseTo(VISUAL_PEAK_MAX, 5);
    expect(result[1]).toBeCloseTo(VISUAL_PEAK_MAX, 5);
  });

  it('flags local peak spikes as transients', () => {
    const bars = buildDawWaveformBars([0.2, 0.3, 0.9, 0.28, 0.25]);

    expect(bars[2].isTransient).toBe(true);
    expect(bars[1].isTransient).toBe(false);
    expect(bars[3].isTransient).toBe(false);
  });

  it('reads raw R2 sidecars through the same-origin proxy, never cross-origin', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ peaks: [0.2, 0.8] }) });
    vi.stubGlobal('fetch', fetch);
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = 'https://pub-abc.r2.dev';

    await expect(loadVisualPeaks('https://pub-abc.r2.dev/peaks/a.json', new AbortController().signal)).resolves.toEqual([0.2, 0.8]);
    expect(fetch.mock.calls[0][0]).toMatch(/^\/api\/audio\?src=/);
  });

  it('loads peaks from a configured CDN URL', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, duration: 12, length: 2, peaks: [0.2, 0.8] }),
    });
    vi.stubGlobal('fetch', fetch);
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = 'https://pub-abc.r2.dev';
    process.env.NEXT_PUBLIC_R2_CDN_URL = 'https://cdn.example.com';

    await expect(loadVisualPeaks('https://pub-abc.r2.dev/peaks/a.json', new AbortController().signal)).resolves.toEqual([0.2, 0.8]);
    expect(fetch).toHaveBeenCalledWith('https://cdn.example.com/peaks/a.json', expect.any(Object));
  });
});

describe('readablePeaksUrl', () => {
  it('proxies r2.dev sidecars, which send no CORS headers', () => {
    expect(readablePeaksUrl('https://pub-abc.r2.dev/peaks/a.json')).toBe(
      `/api/audio?src=${encodeURIComponent('https://pub-abc.r2.dev/peaks/a.json')}`,
    );
  });
  it('keeps same-origin paths direct and drops empty input', () => {
    expect(readablePeaksUrl('/uploads/a.json')).toBe('/uploads/a.json');
    expect(readablePeaksUrl(null)).toBeNull();
  });
});
