import { describe, it, expect } from 'vitest';
import { planPreview, makeTruncatedPreview, truncateWav, isWav, DEFAULT_PREVIEW_SECONDS } from './preview';

/** Build a minimal 16-bit PCM WAV. byteRate = sampleRate * channels * 2. */
function buildWav(dataBytes: number, sampleRate = 1000, channels = 1): Buffer {
  const bits = 16;
  const blockAlign = channels * (bits / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes, 1)]);
}

describe('planPreview', () => {
  it('truncates proportionally to duration', () => {
    // 200s track, 1,000,000 bytes, 75s preview → 37.5% → 375,000 bytes.
    const p = planPreview(1_000_000, 200, 75);
    expect(p.truncated).toBe(true);
    expect(p.bytes).toBe(375_000);
  });

  it('does not truncate a track already <= preview length', () => {
    const p = planPreview(500_000, 60, 75);
    expect(p.truncated).toBe(false);
    expect(p.bytes).toBe(500_000);
  });

  it('returns full length when duration is unknown', () => {
    expect(planPreview(500_000, null).truncated).toBe(false);
    expect(planPreview(500_000, 0).truncated).toBe(false);
    expect(planPreview(500_000, undefined).bytes).toBe(500_000);
  });

  it('never exceeds the original and keeps >= 1 byte', () => {
    const p = planPreview(100, 10_000, 75); // tiny file, huge duration
    expect(p.bytes).toBeGreaterThanOrEqual(1);
    expect(p.bytes).toBeLessThanOrEqual(100);
  });

  it('defaults to DEFAULT_PREVIEW_SECONDS', () => {
    const withDefault = planPreview(1_000_000, 300);
    const explicit = planPreview(1_000_000, 300, DEFAULT_PREVIEW_SECONDS);
    expect(withDefault.bytes).toBe(explicit.bytes);
  });
});

describe('makeTruncatedPreview', () => {
  it('slices the leading bytes when truncation applies', () => {
    const master = Buffer.alloc(1_000_000, 7);
    const { buffer, truncated } = makeTruncatedPreview(master, 200, 75);
    expect(truncated).toBe(true);
    expect(buffer.length).toBe(375_000);
    // Same backing data at the start.
    expect(buffer[0]).toBe(7);
  });

  it('returns the original buffer untouched for short tracks', () => {
    const master = Buffer.alloc(1000, 1);
    const { buffer, truncated, ext } = makeTruncatedPreview(master, 30, 75);
    expect(truncated).toBe(false);
    expect(buffer.length).toBe(1000);
    expect(ext).toBe('mp3');
  });

  it('detects WAV and produces a valid truncated WAV clip', () => {
    // 5s of audio at byteRate 2000 → 10000 PCM bytes; preview 1s → keep 2000.
    const master = buildWav(10_000, 1000, 1);
    expect(isWav(master)).toBe(true);
    const res = makeTruncatedPreview(master, 5, 1);
    expect(res.truncated).toBe(true);
    expect(res.ext).toBe('wav');
    expect(res.contentType).toBe('audio/wav');
    // Output is still a valid WAV with corrected sizes.
    expect(isWav(res.buffer)).toBe(true);
    expect(res.buffer.length).toBe(44 + 2000); // header + 1s PCM
    expect(res.buffer.readUInt32LE(40)).toBe(2000); // data chunk size
    expect(res.buffer.readUInt32LE(4)).toBe(res.buffer.length - 8); // RIFF size
  });
});

describe('truncateWav', () => {
  it('returns null for non-WAV input', () => {
    expect(truncateWav(Buffer.alloc(100, 9))).toBeNull();
  });

  it('returns null when the WAV is already shorter than the preview', () => {
    const master = buildWav(2000, 1000, 1); // 1s, preview 75s
    expect(truncateWav(master, 75)).toBeNull();
  });
});
