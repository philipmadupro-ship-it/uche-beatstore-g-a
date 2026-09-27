import { describe, expect, it } from 'vitest';
import { ffmpegCandidatePaths, probeFfmpeg, type FfmpegProbeDeps } from './ffmpeg-locate';

const TRACED = '/var/task/node_modules/ffmpeg-static/ffmpeg';

function deps(over: Partial<FfmpegProbeDeps> & { files?: string[]; runs?: Record<string, string | null> }): FfmpegProbeDeps {
  const files = new Set(over.files ?? []);
  return {
    exists: over.exists ?? (async (b) => (b.includes('/') ? files.has(b) : null)),
    run: over.run ?? (async (b) => (b in (over.runs ?? {}) ? over.runs![b] : 'ENOENT')),
    copyExecutable: over.copyExecutable ?? (async () => '/tmp/ffmpeg-bin'),
  };
}

describe('ffmpegCandidatePaths', () => {
  it('tries absolute paths — never one relative to an unknown cwd', () => {
    const list = ffmpegCandidatePaths({ envBin: null, cwd: '/var/task/', platform: 'linux' });
    expect(list).toEqual([TRACED, 'ffmpeg']);
    for (const p of list.slice(0, -1)) expect(p.startsWith('/')).toBe(true);
  });

  it('puts FFMPEG_BIN first and also checks /var/task when cwd differs', () => {
    expect(ffmpegCandidatePaths({ envBin: '/opt/bin/ffmpeg', cwd: '/app', platform: 'linux' }))
      .toEqual(['/opt/bin/ffmpeg', '/app/node_modules/ffmpeg-static/ffmpeg', TRACED, 'ffmpeg']);
  });
});

describe('probeFfmpeg', () => {
  it('uses the traced binary when it runs', async () => {
    const r = await probeFfmpeg([TRACED, 'ffmpeg'], deps({ files: [TRACED], runs: { [TRACED]: null } }));
    expect(r.bin).toBe(TRACED);
  });

  it('copies to /tmp and chmods when the packaged binary lost its execute bit', async () => {
    const r = await probeFfmpeg([TRACED], deps({ files: [TRACED], runs: { [TRACED]: 'EACCES', '/tmp/ffmpeg-bin': null } }));
    expect(r.bin).toBe('/tmp/ffmpeg-bin');
    expect(r.attempts[0]).toMatchObject({ bin: TRACED, error: 'EACCES', copiedTo: '/tmp/ffmpeg-bin' });
  });

  it('records why every candidate failed, instead of failing silently', async () => {
    const r = await probeFfmpeg(
      ['/app/node_modules/ffmpeg-static/ffmpeg', TRACED, 'ffmpeg'],
      deps({ files: [TRACED], runs: { [TRACED]: 'exit 1: libc mismatch', ffmpeg: 'ENOENT' } }),
    );
    expect(r.bin).toBeNull();
    expect(r.attempts.map((a) => a.error)).toEqual(['not found', 'exit 1: libc mismatch', 'ENOENT']);
  });

  it('does not copy a missing file or a bare command name', async () => {
    let copies = 0;
    await probeFfmpeg(['ffmpeg'], deps({ runs: { ffmpeg: 'EACCES' }, copyExecutable: async () => { copies++; return '/tmp/x'; } }));
    expect(copies).toBe(0);
  });

  it('reports a failed copy rather than throwing', async () => {
    const r = await probeFfmpeg([TRACED], deps({
      files: [TRACED],
      runs: { [TRACED]: 'EACCES' },
      copyExecutable: async () => { throw new Error('ENOSPC'); },
    }));
    expect(r.bin).toBeNull();
    expect(r.attempts[0].error).toBe('EACCES; copy failed: ENOSPC');
  });
});
