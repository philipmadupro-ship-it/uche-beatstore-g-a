// Real ffmpeg, not a mock: the claim is that a WAV master becomes a playable
// 320 kbps MP3. Skipped on a machine without ffmpeg.
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

vi.mock('server-only', () => ({}));

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** A 2 s stereo 44.1 kHz 16-bit sine as a WAV file. */
function sineWav(seconds = 2): Buffer {
  const rate = 44100;
  const frames = rate * seconds;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000);
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe.skipIf(!hasFfmpeg)('makeDeliveryMp3Buffer (real ffmpeg)', () => {
  it('turns a whole WAV master into a stereo 320 kbps MP3', async () => {
    const { makeDeliveryMp3Buffer } = await import('./convert');
    const wav = sineWav(2);
    const out = await makeDeliveryMp3Buffer(wav);

    expect(out).not.toBeNull();
    const buf = out!;
    // An MP3 starts with an ID3 tag or an MPEG frame sync (0xFFEx / 0xFFFx).
    const isMp3 = buf.subarray(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    expect(isMp3).toBe(true);
    // 2 s at 320 kbps is ~80 kB; far smaller than the 352 kB WAV, and not a truncated clip.
    expect(buf.length).toBeGreaterThan(70_000);
    expect(buf.length).toBeLessThan(wav.length);

    // The whole 2 s, not a clip: 320 kbps is 40 000 bytes a second.
    expect(buf.length / 40_000).toBeGreaterThan(1.8);
    expect(buf.length / 40_000).toBeLessThan(2.3);

    // Ask ffprobe what it made (a pipe has no duration, so codec and channels only).
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels', '-of', 'default=nw=1', '-'], { input: buf });
    if (probe.status === 0) {
      const text = probe.stdout.toString();
      expect(text).toMatch(/codec_name=mp3/);
      expect(text).toMatch(/channels=2/);
    }
  });

  it('returns null for bytes that are not audio', async () => {
    const { makeDeliveryMp3Buffer } = await import('./convert');
    expect(await makeDeliveryMp3Buffer(Buffer.from('this is not audio at all'))).toBeNull();
  });
});
