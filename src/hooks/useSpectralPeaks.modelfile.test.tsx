// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSpectralPeaks } from './useSpectralPeaks';
import { buildWaveformModel } from '@/lib/visuals/waveform-model';
import { encodeWaveformFile } from '@/lib/visuals/waveform-file';

const SR = 22050;
function sine(seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
  return out;
}

const AUDIO = 'https://cdn.example/previews/a.mp3';
const FILE = 'https://cdn.example/previews/a.mp3.wave.bin';

let fetchMock: ReturnType<typeof vi.fn>;

function fileBytes(): Uint8Array {
  const model = buildWaveformModel(sine(2), SR);
  const db = new Array(512).fill(-20);
  const hz = new Array(512).fill(220);
  return encodeWaveformFile(model, { db, hz });
}

beforeEach(() => {
  class FakeOfflineAudioContext {
    decodeAudioData() {
      return Promise.resolve({ duration: 2, sampleRate: SR, getChannelData: () => sine(2) });
    }
  }
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  (window as unknown as Record<string, unknown>).OfflineAudioContext = FakeOfflineAudioContext;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('useSpectralPeaks: the server-built model file', () => {
  it('uses the file first and never fetches or decodes the audio', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === FILE) return new Response(fileBytes() as BlobPart, { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    const { result } = renderHook(() => useSpectralPeaks('t-file', AUDIO, 512, undefined, '/api/store/preview/t-file', FILE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.source).toBe('model-file');
    expect(result.current.model?.all.length).toBeGreaterThan(0);
    expect(result.current.resolution).toBe(441);
    expect(result.current.db).toHaveLength(512);
    expect(result.current.hz?.[10]).toBe(220);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back silently to decoding when the file is 404', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === FILE) return new Response('nope', { status: 404 });
      return new Response(new ArrayBuffer(8), { status: 200 });
    });
    const { result } = renderHook(() => useSpectralPeaks('t-404', AUDIO, 512, undefined, null, FILE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.source).toBe('analysis');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([FILE, AUDIO]);
  });

  it('falls back when the file has a bad magic (an HTML error page, say)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === FILE) return new Response('<html>Not found</html>', { status: 200 });
      return new Response(new ArrayBuffer(8), { status: 200 });
    });
    const { result } = renderHook(() => useSpectralPeaks('t-bad', AUDIO, 512, undefined, null, FILE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.source).toBe('analysis');
  });

  it('does not ask again for a file that was missing, and caches a good one under its own source', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === FILE) return new Response('nope', { status: 404 });
      return new Response(new ArrayBuffer(8), { status: 200 });
    });
    const first = renderHook(() => useSpectralPeaks('t-once', AUDIO, 512, undefined, null, FILE));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();
    const before = fetchMock.mock.calls.filter((c) => c[0] === FILE).length;
    const second = renderHook(() => useSpectralPeaks('t-once', AUDIO, 512, undefined, null, FILE));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(fetchMock.mock.calls.filter((c) => c[0] === FILE).length).toBe(before);
  });

  it('without a file URL it decodes exactly as before', async () => {
    fetchMock.mockImplementation(async () => new Response(new ArrayBuffer(8), { status: 200 }));
    const { result } = renderHook(() => useSpectralPeaks('t-none', AUDIO, 512));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.source).toBe('analysis');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
