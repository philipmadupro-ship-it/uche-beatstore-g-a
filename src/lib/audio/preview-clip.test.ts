import { describe, expect, it } from 'vitest';
import { buildPreviewClip } from './preview-clip';

const mp3Master = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4_000_000, 1)]);
const noFfmpeg = async () => null;

describe('buildPreviewClip', () => {
  it('prefers the ffmpeg 75 s MP3 clip', async () => {
    const clip = await buildPreviewClip(mp3Master, 'r2://private/tracks/a.wav', 180, async (_m, s) => {
      expect(s).toBe(75);
      return Buffer.from('mp3-clip');
    });
    expect(clip).toEqual({ buffer: Buffer.from('mp3-clip'), ext: 'mp3', contentType: 'audio/mpeg' });
  });

  it('byte-truncates an mp3 master when ffmpeg is unavailable (the production upload case)', async () => {
    const clip = await buildPreviewClip(mp3Master, 'r2://private/tracks/a.mp3', 180, noFfmpeg);
    expect(clip?.ext).toBe('mp3');
    // A clip, not the whole master: 75 of 180 seconds.
    expect(clip!.buffer.length).toBeLessThan(mp3Master.length);
  });

  it('treats a throwing ffmpeg like a missing one', async () => {
    const clip = await buildPreviewClip(mp3Master, 'beat.mp3', 180, async () => { throw new Error('spawn ENOENT'); });
    expect(clip?.ext).toBe('mp3');
  });

  it('returns null rather than publishing an unplayable slice of flac/aiff/m4a', async () => {
    for (const ref of ['r2://p/tracks/a.flac', 'x.aiff', 'y.m4a', null]) {
      expect(await buildPreviewClip(mp3Master, ref, 180, noFfmpeg)).toBeNull();
    }
  });
});
