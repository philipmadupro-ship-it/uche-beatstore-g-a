import { describe, it, expect, vi } from 'vitest';
import {
  canDeriveMp3,
  ensureMp3Deliverable,
  isMp3Master,
  mp3DeliverableKey,
  mp3DeliverablePrefix,
  pruneMp3Deliverables,
  supersededDeliverableKeys,
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

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const OLD = 'r2://private/tracks/old.wav';
const NEW = 'r2://private/tracks/new.wav';

describe('supersededDeliverableKeys', () => {
  it('names the derivatives of masters the track no longer has, and keeps the current one', () => {
    const keys = [mp3DeliverableKey(T1, OLD), mp3DeliverableKey(T1, NEW)];
    expect(supersededDeliverableKeys(keys, T1, NEW)).toEqual([mp3DeliverableKey(T1, OLD)]);
  });

  it('names all of them when the track no longer needs one (deleted, or now an MP3 master)', () => {
    const keys = [mp3DeliverableKey(T1, OLD), mp3DeliverableKey(T1, NEW)];
    expect(supersededDeliverableKeys(keys, T1, null)).toHaveLength(2);
    expect(supersededDeliverableKeys(keys, T1, 'r2://private/tracks/now.mp3')).toHaveLength(2);
  });

  it('can never name anything but this track\'s own derivatives', () => {
    const hostile = [
      `tracks/${T1}.wav`,                              // a master
      'tracks/abc123.wav',
      mp3DeliverableKey(T2, OLD),                      // another track's derivative
      `deliverables/${T1}-notahash.mp3`,               // wrong shape
      `deliverables/${T1}-0123456789ab.wav`,           // wrong extension
      `deliverables/${T1}-0123456789ab.mp3.bak`,
      `deliverables/${T1}-0123456789ab/../../tracks/master.wav`,
      `xdeliverables/${T1}-0123456789ab.mp3`,
      `${mp3DeliverablePrefix(T1)}`,                   // the bare prefix
      '',
    ];
    expect(supersededDeliverableKeys(hostile, T1, NEW)).toEqual([]);
  });

  it('refuses to build a pattern from something that is not a track uuid', () => {
    expect(supersededDeliverableKeys([mp3DeliverableKey('t1', OLD)], 't1', NEW)).toEqual([]);
    expect(supersededDeliverableKeys(['deliverables/x-0123456789ab.mp3'], '.*', NEW)).toEqual([]);
    expect(supersededDeliverableKeys([], T1, NEW)).toEqual([]);
  });

  it('lists each key once', () => {
    const k = mp3DeliverableKey(T1, OLD);
    expect(supersededDeliverableKeys([k, k], T1, NEW)).toEqual([k]);
  });
});

describe('pruneMp3Deliverables', () => {
  it('lists this track\'s prefix and removes only the superseded keys', async () => {
    const list = vi.fn().mockResolvedValue([mp3DeliverableKey(T1, OLD), mp3DeliverableKey(T1, NEW)]);
    const remove = vi.fn().mockResolvedValue(undefined);

    expect(await pruneMp3Deliverables({ id: T1, audio_url: NEW }, { list, remove })).toBe(1);
    expect(list).toHaveBeenCalledWith(`deliverables/${T1}-`);
    expect(remove).toHaveBeenCalledWith([mp3DeliverableKey(T1, OLD)]);
  });

  it('does not call remove when nothing is superseded', async () => {
    const remove = vi.fn();
    expect(await pruneMp3Deliverables({ id: T1, audio_url: NEW }, { list: async () => [mp3DeliverableKey(T1, NEW)], remove })).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it('never throws, so a failed cleanup cannot fail what triggered it', async () => {
    const down = { list: vi.fn().mockRejectedValue(new Error('R2 down')), remove: vi.fn() };
    await expect(pruneMp3Deliverables({ id: T1, audio_url: NEW }, down)).resolves.toBe(0);
    const failing = { list: async () => [mp3DeliverableKey(T1, OLD)], remove: vi.fn().mockRejectedValue(new Error('403')) };
    await expect(pruneMp3Deliverables({ id: T1, audio_url: NEW }, failing)).resolves.toBe(0);
  });
});

describe('ensureMp3Deliverable prunes only when it makes a NEW derivative', () => {
  const t = { id: T1, audio_url: NEW };

  it('prunes after storing a new one', async () => {
    const prune = vi.fn().mockResolvedValue(1);
    const result = await ensureMp3Deliverable(t, deps({ prune }));
    expect(result).toMatchObject({ kind: 'ref', created: true });
    expect(prune).toHaveBeenCalledWith({ id: T1, audio_url: NEW });
  });

  it('does not prune when the derivative already exists, the master is an MP3, or it could not be stored', async () => {
    const prune = vi.fn();
    await ensureMp3Deliverable(t, deps({ prune, exists: vi.fn().mockResolvedValue(true) }));
    await ensureMp3Deliverable({ id: T1, audio_url: 'r2://b/k.mp3' }, deps({ prune }));
    await ensureMp3Deliverable(t, deps({ prune, put: vi.fn().mockRejectedValue(new Error('down')) }));
    expect(prune).not.toHaveBeenCalled();
  });

  it('still returns the new derivative if pruning fails', async () => {
    const result = await ensureMp3Deliverable(t, deps({ prune: vi.fn().mockRejectedValue(new Error('boom')) }));
    expect(result).toMatchObject({ kind: 'ref', created: true });
  });
});

describe('lifecycle over an in-memory object store', () => {
  /** The same deps the server wires, backed by a Set instead of R2. */
  function store() {
    const objects = new Set<string>(['tracks/master-old.wav', 'tracks/master-new.wav', `stems/${T1}-0123456789ab.mp3`]);
    const ref = (k: string) => `r2://private/${k}`;
    const d: EnsureMp3Deps = {
      refFor: (key) => ref(key),
      exists: async (r) => objects.has(r.replace('r2://private/', '')),
      readMaster: async () => Buffer.from('RIFF'),
      transcode: async () => Buffer.from('ID3-mp3'),
      put: async (key) => { objects.add(key); return ref(key); },
      prune: (t) => pruneMp3Deliverables(t, {
        list: async (prefix) => [...objects].filter((k) => k.startsWith(prefix)),
        remove: async (keys) => { for (const k of keys) objects.delete(k); },
      }),
    };
    return { objects, d };
  }
  const derivatives = (objects: Set<string>) => [...objects].filter((k) => k.startsWith('deliverables/')).sort();

  it('keeps exactly one MP3 per track as its master changes, and none once it is deleted', async () => {
    const { objects, d } = store();

    await ensureMp3Deliverable({ id: T1, audio_url: OLD }, d);
    expect(derivatives(objects)).toEqual([mp3DeliverableKey(T1, OLD)]);

    // The master changes (a version revert): the next MP3 supersedes the old one.
    await ensureMp3Deliverable({ id: T1, audio_url: NEW }, d);
    expect(derivatives(objects)).toEqual([mp3DeliverableKey(T1, NEW)]);

    // Another track's derivative is never touched.
    await ensureMp3Deliverable({ id: T2, audio_url: OLD }, d);
    await ensureMp3Deliverable({ id: T1, audio_url: OLD }, d);
    expect(derivatives(objects)).toEqual([mp3DeliverableKey(T1, OLD), mp3DeliverableKey(T2, OLD)].sort());

    // The track is deleted: only ITS derivatives go.
    await pruneMp3Deliverables({ id: T1, audio_url: null }, {
      list: async (p) => [...objects].filter((k) => k.startsWith(p)),
      remove: async (keys) => { for (const k of keys) objects.delete(k); },
    });
    expect(derivatives(objects)).toEqual([mp3DeliverableKey(T2, OLD)]);

    // Masters and anything else in the bucket are intact throughout.
    expect(objects.has('tracks/master-old.wav')).toBe(true);
    expect(objects.has('tracks/master-new.wav')).toBe(true);
    expect(objects.has(`stems/${T1}-0123456789ab.mp3`)).toBe(true);
  });
});
