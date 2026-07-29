import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDawWaveformBars, loadVisualPeaks, resampleVisualPeaks, syntheticVisualPeaks } from './visual-peaks';

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

  it('marks DAW-style beat grid positions and downbeats', () => {
    const bars = buildDawWaveformBars(Array(17).fill(0.4));

    expect(bars.filter((bar) => bar.isBeat).map((bar) => bar.index)).toEqual([0, 4, 8, 12, 16]);
    expect(bars.filter((bar) => bar.isDownbeat).map((bar) => bar.index)).toEqual([0, 16]);
    expect(bars[0]).toMatchObject({ isBeat: true, isDownbeat: true });
    expect(bars[4]).toMatchObject({ isBeat: true, isDownbeat: false });
  });

  it('flags local peak spikes as transients', () => {
    const bars = buildDawWaveformBars([0.2, 0.3, 0.9, 0.28, 0.25]);

    expect(bars[2].isTransient).toBe(true);
    expect(bars[1].isTransient).toBe(false);
    expect(bars[3].isTransient).toBe(false);
  });

  it('skips unreadable raw R2 sidecars without fetching', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = 'https://pub-abc.r2.dev';

    await expect(loadVisualPeaks('https://pub-abc.r2.dev/peaks/a.json', new AbortController().signal)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
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
