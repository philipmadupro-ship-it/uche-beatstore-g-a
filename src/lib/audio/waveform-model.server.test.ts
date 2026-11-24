import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/storage/upload', () => ({ readStoredObject: vi.fn(), uploadWaveModelFile: vi.fn() }));

import { buildWaveformFileFromPcm, ensureWaveformModelFile, type WaveformModelDeps } from './waveform-model.server';
import { buildWaveformModel } from '@/lib/visuals/waveform-model';
import { decodeWaveformFile } from '@/lib/visuals/waveform-file';
import { BANDS_SLICES, readoutFromMono } from '@/lib/audio/peaks';
import { rmsToDb } from '@/lib/audio/pitch';
import { sliceRms } from '@/lib/audio/band-filter';

const SR = 44100;
function pcm(seconds = 3): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const kick = t % 0.5 < 0.1 ? Math.sin(2 * Math.PI * 55 * t) * 0.9 : 0;
    out[i] = kick + 0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.08 * Math.sin(2 * Math.PI * 8000 * t);
  }
  // a silent gap, so the readout has a floor
  out.fill(0, SR * 2, SR * 2.3);
  return out;
}

describe('buildWaveformFileFromPcm', () => {
  it('holds byte-identical arrays to the client buildWaveformModel on the same PCM', () => {
    const mono = pcm();
    const client = buildWaveformModel(mono, SR);
    const file = decodeWaveformFile(buildWaveformFileFromPcm(mono, SR))!;
    expect(file).not.toBeNull();
    for (const k of ['all', 'low', 'mid', 'high'] as const) {
      expect(Buffer.from(file.model[k]).equals(Buffer.from(client[k]))).toBe(true);
    }
    expect(file.model.columnsPerSecond).toBe(client.columnsPerSecond);
    expect(file.model.peak).toBeCloseTo(client.peak, 6);
  });

  it('carries the readout the bands sidecar computes (db ±1 dB, hz ±1 Hz)', () => {
    const mono = pcm();
    const file = decodeWaveformFile(buildWaveformFileFromPcm(mono, SR))!;
    const expected = readoutFromMono(mono, SR);
    expect(file.readout.db).toHaveLength(BANDS_SLICES);
    expect(expected.db).toEqual(sliceRms(mono, BANDS_SLICES).map(rmsToDb));
    expect(expected.hz.some((v) => v === null)).toBe(true); // the gap
    expect(expected.hz.some((v) => v !== null)).toBe(true);
    for (let i = 0; i < BANDS_SLICES; i += 1) {
      expect(Math.abs(file.readout.db[i] - expected.db[i])).toBeLessThanOrEqual(1);
      const h = expected.hz[i];
      if (h == null) expect(file.readout.hz[i]).toBeNull();
      else expect(Math.abs((file.readout.hz[i] as number) - h)).toBeLessThanOrEqual(1);
    }
  });
});

describe('ensureWaveformModelFile', () => {
  const deps = (over: Partial<WaveformModelDeps> = {}): WaveformModelDeps => ({
    read: vi.fn(async () => Buffer.from('audio')),
    decode: vi.fn(async () => pcm(1)),
    put: vi.fn(async (url: string) => `${url}.wave.bin`),
    ...over,
  });

  it('reads the PUBLIC preview, builds the file and stores it beside it', async () => {
    const d = deps();
    expect(await ensureWaveformModelFile('https://pub.r2.dev/previews/a.mp3', d)).toBe('written');
    expect(d.read).toHaveBeenCalledWith('https://pub.r2.dev/previews/a.mp3');
    const [url, bytes] = (d.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://pub.r2.dev/previews/a.mp3');
    expect(decodeWaveformFile(bytes as Uint8Array)).not.toBeNull();
  });

  it('never touches an org recording or a private reference', async () => {
    const d = deps();
    const org = 'r2://priv/orgs/0b7f0e0a-1111-4222-8333-444455556666/tracks/x.wav';
    expect(await ensureWaveformModelFile(org, d)).toBe('skipped');
    expect(await ensureWaveformModelFile('r2://priv/orgs/o/previews/x.mp3', d)).toBe('skipped');
    expect(await ensureWaveformModelFile(null, d)).toBe('skipped');
    expect(d.read).not.toHaveBeenCalled();
    expect(d.put).not.toHaveBeenCalled();
  });

  it('reports failure instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await ensureWaveformModelFile('https://p/a.mp3', deps({ read: vi.fn(async () => { throw new Error('boom'); }) }))).toBe('failed');
    expect(await ensureWaveformModelFile('https://p/a.mp3', deps({ decode: vi.fn(async () => null) }))).toBe('failed');
    expect(await ensureWaveformModelFile('https://p/a.mp3', deps({ put: vi.fn(async () => null) }))).toBe('failed');
    warn.mockRestore();
  });
});

describe('real ffmpeg decode → file', () => {
  it('decodes an mp3/wav to mono float PCM at 44.1 kHz and builds a readable file (skipped without ffmpeg)', async () => {
    const { decodeToMonoFloat32, ffmpegStatus } = await import('@/lib/audio/convert');
    if (!(await ffmpegStatus()).available) return;
    // 1 s, 16-bit stereo WAV of a 220 Hz tone at 22.05 kHz: ffmpeg must resample and downmix.
    const rate = 22050, frames = rate, data = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i += 1) {
      const v = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 220 * i) / rate));
      data.writeInt16LE(v, i * 4); data.writeInt16LE(v, i * 4 + 2);
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
    head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
    head.write('data', 36); head.writeUInt32LE(data.length, 40);
    const mono = await decodeToMonoFloat32(Buffer.concat([head, data]), 44100);
    expect(mono).not.toBeNull();
    expect(Math.abs((mono as Float32Array).length - 44100)).toBeLessThan(200);
    const file = decodeWaveformFile(buildWaveformFileFromPcm(mono as Float32Array, 44100))!;
    expect(file.model.all.length).toBe(Math.ceil(((mono as Float32Array).length / 44100) * 441));
    expect(file.model.peak).toBeGreaterThan(0.4);
    expect(file.readout.hz.some((h) => h != null && Math.abs(h - 220) < 6)).toBe(true);
  });
});
