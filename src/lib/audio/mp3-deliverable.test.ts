import { describe, it, expect, vi } from 'vitest';
import {
  canDeriveMp3,
  ensureMp3Deliverable,
  isMp3Master,
  mp3DeliverableKey,
  prepareMp3Deliverable,
  type EnsureMp3Deps,
} from './mp3-deliverable';

const WAV = 'r2://private/tracks/abc.wav';
const track = { id: 'track-1', audio_url: WAV };
const mp3 = Buffer.from('ID3-fake-mp3');

function deps(over: Partial<EnsureMp3Deps> = {}): EnsureMp3Deps {
  return {
    refFor: (key) => `r2://private/${key}`,
    exists: vi.fn().mockResolvedValue(false),
    readMaster: vi.fn().mockResolvedValue(Buffer.from('RIFF-fake-wav')),
    transcode: vi.fn().mockResolvedValue(mp3),
    put: vi.fn().mockImplementation(async (key: string) => `r2://private/${key}`),
    ...over,
  };
}

describe('format rules', () => {
  it('knows which masters are already MP3 and which can be turned into one', () => {
    expect(isMp3Master('r2://b/k.mp3')).toBe(true);
    expect(isMp3Master('https://cdn.example.test/a.MP3?x=1')).toBe(true);
    expect(isMp3Master(WAV)).toBe(false);
    for (const ext of ['wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg']) {
      expect(canDeriveMp3(`r2://b/k.${ext}`)).toBe(true);
    }
    expect(canDeriveMp3('r2://b/k.mp3')).toBe(false);
    expect(canDeriveMp3('r2://b/k.zip')).toBe(false);
    expect(canDeriveMp3(null)).toBe(false);
  });
});

describe('mp3DeliverableKey', () => {
  it('is stable for one master and different for another, so a replaced master never reuses a stale MP3', () => {
    expect(mp3DeliverableKey('track-1', WAV)).toBe(mp3DeliverableKey('track-1', WAV));
    expect(mp3DeliverableKey('track-1', WAV)).not.toBe(mp3DeliverableKey('track-1', 'r2://private/tracks/other.wav'));
    expect(mp3DeliverableKey('track-1', WAV)).not.toBe(mp3DeliverableKey('track-2', WAV));
    expect(mp3DeliverableKey('track-1', WAV)).toMatch(/^deliverables\/track-1-[0-9a-f]{12}\.mp3$/);
  });
});

describe('ensureMp3Deliverable', () => {
  it('serves an MP3 master as it is, without transcoding', async () => {
    const d = deps();
    const result = await ensureMp3Deliverable({ id: 't', audio_url: 'r2://b/k.mp3' }, d);

    expect(result).toEqual({ kind: 'ref', ref: 'r2://b/k.mp3', created: false });
    expect(d.transcode).not.toHaveBeenCalled();
  });

  it('reuses the stored derivative without reading the master', async () => {
    const d = deps({ exists: vi.fn().mockResolvedValue(true) });
    const result = await ensureMp3Deliverable(track, d);

    expect(result).toMatchObject({ kind: 'ref', created: false });
    expect(d.readMaster).not.toHaveBeenCalled();
    expect(d.transcode).not.toHaveBeenCalled();
  });

  it('makes and stores the MP3 from a WAV master on the first request', async () => {
    const d = deps();
    const result = await ensureMp3Deliverable(track, d);

    const key = mp3DeliverableKey('track-1', WAV);
    expect(result).toEqual({ kind: 'ref', ref: `r2://private/${key}`, created: true });
    expect(d.readMaster).toHaveBeenCalledWith(WAV);
    expect(d.put).toHaveBeenCalledWith(key, mp3);
  });

  it('serves the bytes it just made when they cannot be stored', async () => {
    const d = deps({ put: vi.fn().mockRejectedValue(new Error('R2 down')) });
    expect(await ensureMp3Deliverable(track, d)).toEqual({ kind: 'buffer', buffer: mp3 });
  });

  it('serves the bytes when there is no private storage to keep them in', async () => {
    const d = deps({ refFor: () => null });
    expect(await ensureMp3Deliverable(track, d)).toEqual({ kind: 'buffer', buffer: mp3 });
    expect(d.put).not.toHaveBeenCalled();
  });

  it('returns null — never the master — when it cannot be made', async () => {
    expect(await ensureMp3Deliverable(track, deps({ transcode: vi.fn().mockResolvedValue(null) }))).toBeNull();
    expect(await ensureMp3Deliverable(track, deps({ transcode: vi.fn().mockResolvedValue(Buffer.alloc(0)) }))).toBeNull();
    expect(await ensureMp3Deliverable(track, deps({ readMaster: vi.fn().mockRejectedValue(new Error('gone')) }))).toBeNull();
    expect(await ensureMp3Deliverable({ id: 't', audio_url: 'r2://b/k.zip' }, deps())).toBeNull();
    expect(await ensureMp3Deliverable({ id: 't', audio_url: null }, deps())).toBeNull();
  });
});

describe('prepareMp3Deliverable (upload time)', () => {
  it('makes the MP3 from the master it was handed, without reading storage again', async () => {
    const d = deps({ readMaster: vi.fn().mockRejectedValue(new Error('must not be called')) });
    const master = Buffer.from('RIFF-in-memory');
    const result = await prepareMp3Deliverable(track, master, d);

    expect(result).toMatchObject({ kind: 'ref', created: true });
    expect(d.transcode).toHaveBeenCalledWith(master);
  });

  it('does nothing for an MP3 master', async () => {
    const d = deps();
    expect(await prepareMp3Deliverable({ id: 't', audio_url: 'r2://b/k.mp3' }, Buffer.from('x'), d)).toBeNull();
    expect(d.transcode).not.toHaveBeenCalled();
  });

  it('never throws, so a failed transcode cannot fail the upload', async () => {
    const d = deps({ transcode: vi.fn().mockRejectedValue(new Error('ffmpeg crashed')) });
    await expect(prepareMp3Deliverable(track, Buffer.from('x'), d)).resolves.toBeNull();
  });
});
