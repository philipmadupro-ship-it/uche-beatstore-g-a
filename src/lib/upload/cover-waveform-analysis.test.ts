import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeCoverWaveform } from './cover-waveform-analysis';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('cover waveform analysis helper', () => {
  it('requests peaks backfill for a selected track', async () => {
    const fetchMock = mockFetch({ ok: true, body: { peaks_url: '/peaks/t-1.json' } });

    await expect(analyzeCoverWaveform('track 1')).resolves.toEqual({
      peaksUrl: '/peaks/t-1.json',
      skipped: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/tracks/track%201/peaks', { method: 'POST' });
  });

  it('preserves already-present status', async () => {
    mockFetch({ ok: true, body: { peaks_url: '/peaks/t-1.json', skipped: 'already-present' } });

    await expect(analyzeCoverWaveform('track-1')).resolves.toEqual({
      peaksUrl: '/peaks/t-1.json',
      skipped: 'already-present',
    });
  });

  it('requires a selected track and safe API response', async () => {
    await expect(analyzeCoverWaveform(' ')).rejects.toThrow('Choose a track');

    mockFetch({ ok: false, status: 502, body: { error: 'Could not read audio' } });
    await expect(analyzeCoverWaveform('track-1')).rejects.toThrow('Could not read audio');

    mockFetch({ ok: true, body: {} });
    await expect(analyzeCoverWaveform('track-1')).rejects.toThrow('without a peaks file');
  });
});
