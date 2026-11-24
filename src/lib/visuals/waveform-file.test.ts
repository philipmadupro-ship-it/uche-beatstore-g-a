import { describe, expect, it } from 'vitest';
import { buildWaveformModel } from './waveform-model';
import {
  decodeWaveformFile, encodeWaveformFile, waveFileUrlFor, waveModelFileUrl, WAVE_FILE_HEADER_BYTES,
} from './waveform-file';

function fixture() {
  const sr = 44100;
  const mono = new Float32Array(sr * 2);
  for (let i = 0; i < mono.length; i += 1) {
    mono[i] = 0.6 * Math.sin((2 * Math.PI * 110 * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 6000 * i) / sr);
  }
  return buildWaveformModel(mono, sr);
}

const readout = () => {
  const db = Array.from({ length: 512 }, (_, i) => -((i % 60) + 0.4));
  db[3] = -100; // silence floor
  const hz: (number | null)[] = Array.from({ length: 512 }, (_, i) => (i % 5 === 0 ? null : 110 + i));
  return { db, hz };
};

describe('waveform file', () => {
  it('round-trips the model arrays exactly, and the readout (null hz and silence included)', () => {
    const model = fixture();
    const { db, hz } = readout();
    const bytes = encodeWaveformFile(model, { db, hz });
    expect(bytes.length).toBe(WAVE_FILE_HEADER_BYTES + 4 * model.all.length + 2 + 512 * 3);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('U2CW');

    const file = decodeWaveformFile(bytes)!;
    expect(file).not.toBeNull();
    expect(Array.from(file.model.all)).toEqual(Array.from(model.all));
    expect(Array.from(file.model.low)).toEqual(Array.from(model.low));
    expect(Array.from(file.model.mid)).toEqual(Array.from(model.mid));
    expect(Array.from(file.model.high)).toEqual(Array.from(model.high));
    expect(file.model.columnsPerSecond).toBe(model.columnsPerSecond);
    expect(file.model.peak).toBeCloseTo(model.peak, 6);
    expect(file.readout.hz[0]).toBeNull();
    expect(file.readout.hz[1]).toBe(111);
    expect(file.readout.db[3]).toBe(-100);
    for (let i = 0; i < 512; i += 1) {
      if (i !== 3) expect(Math.abs(file.readout.db[i] - db[i])).toBeLessThanOrEqual(1);
      if (hz[i] != null) expect(Math.abs((file.readout.hz[i] as number) - (hz[i] as number))).toBeLessThanOrEqual(1);
    }
  });

  it('clamps dB to at most 0 and reads anything at or below the -100 floor as silence', () => {
    const model = fixture();
    const f = decodeWaveformFile(encodeWaveformFile(model, { db: [6, -120, -0.4], hz: [1, 2, 70000] }))!;
    expect(f.readout.db).toEqual([0, -100, 0]);
    expect(f.readout.hz[2]).toBe(65535);
  });

  it('refuses a bad magic, a bad version, a truncated file and trailing bytes', () => {
    const good = encodeWaveformFile(fixture(), readout());
    expect(decodeWaveformFile(good)).not.toBeNull();
    const badMagic = good.slice(); badMagic[0] = 0x58;
    expect(decodeWaveformFile(badMagic)).toBeNull();
    const badVersion = good.slice(); badVersion[4] = 2;
    expect(decodeWaveformFile(badVersion)).toBeNull();
    expect(decodeWaveformFile(good.slice(0, good.length - 1))).toBeNull();
    expect(decodeWaveformFile(good.slice(0, 20))).toBeNull();
    const extra = new Uint8Array(good.length + 1); extra.set(good);
    expect(decodeWaveformFile(extra)).toBeNull();
    expect(decodeWaveformFile(new TextEncoder().encode('{"error":"Not found"}'))).toBeNull();
    expect(decodeWaveformFile(new ArrayBuffer(0))).toBeNull();
  });

  it('decodes from an ArrayBuffer and from an offset view', () => {
    const good = encodeWaveformFile(fixture(), readout());
    expect(decodeWaveformFile(good.buffer.slice(0) as ArrayBuffer)).not.toBeNull();
    const padded = new Uint8Array(good.length + 7); padded.set(good, 7);
    expect(decodeWaveformFile(padded.subarray(7))).not.toBeNull();
  });
});

describe('where the file lives', () => {
  it('is the preview URL plus .wave.bin, for public and local previews only', () => {
    expect(waveFileUrlFor('https://pub.r2.dev/previews/a.mp3')).toBe('https://pub.r2.dev/previews/a.mp3.wave.bin');
    expect(waveFileUrlFor('/uploads/previews/a.mp3')).toBe('/uploads/previews/a.mp3.wave.bin');
    expect(waveFileUrlFor('r2://private/orgs/x/previews/a.mp3')).toBeNull();
    expect(waveFileUrlFor('/api/store/preview/abc')).toBeNull();
    expect(waveFileUrlFor('https://x/a.mp3?sig=1')).toBeNull();
    expect(waveFileUrlFor(null)).toBeNull();
  });

  it('uses the same-origin route when the preview host is not readable, a local path as is, else nothing', () => {
    // a direct R2 host (no CORS) → the store route
    expect(waveModelFileUrl('https://pub-abc.r2.dev/previews/a.mp3', '/api/store/preview/t1')).toBe('/api/store/wave/t1');
    // the proxied preview → the route
    expect(waveModelFileUrl('/api/store/preview/t1', '/api/store/preview/t1')).toBe('/api/store/wave/t1');
    // local
    expect(waveModelFileUrl('/uploads/previews/a.mp3', '/api/store/preview/t1')).toBe('/uploads/previews/a.mp3.wave.bin');
    // dashboard: private reference, no store route
    expect(waveModelFileUrl('r2://b/masters/a.wav', null)).toBeNull();
    expect(waveModelFileUrl('https://pub-abc.r2.dev/previews/a.mp3', null)).toBeNull();
    // release pages have no preview route
    expect(waveModelFileUrl('/api/store/releases/r/audio/i', null)).toBeNull();
    expect(waveModelFileUrl(null, '/api/store/preview/t1')).toBeNull();
  });
});
