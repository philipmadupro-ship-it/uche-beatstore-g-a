import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DERIVATIVE_MAX_RANGE_BYTES as CAP } from '@/lib/audio/range-cap';

vi.mock('server-only', () => ({}));
const readMaster = vi.fn();
vi.mock('@/lib/storage/upload', () => ({ r2: {}, readStoredObject: (...a: unknown[]) => readMaster(...a) }));

const ORG = '10000000-0000-4000-8000-0000000000a1';
const T = '50000000-0000-4000-8000-000000000001';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'derivative-'));
  readMaster.mockReset().mockResolvedValue(Buffer.from('MASTER-BYTES'));
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PRIVATE_BUCKET_NAME']) delete process.env[k];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const lib = () => import('./org-derivative');
const body = async (res: Response) => Buffer.from(await res.arrayBuffer());
const file = () => path.join(root, 'orgs', ORG, 'derivatives', `${T}.mp3`);

describe('ensureFullDerivative', () => {
  it('cuts the master once into data/orgs/<org>/derivatives (never public/), and finds it again', async () => {
    const { ensureFullDerivative, hasFullDerivative } = await lib();
    const cut = vi.fn(async () => Buffer.from('LOSSY'));
    expect(await hasFullDerivative(ORG, T, root)).toBe(false);
    expect(await ensureFullDerivative(ORG, T, '/uploads/orgs/a/tracks/1.wav', { root, cut })).toBe(true);
    expect(fs.readFileSync(file(), 'utf8')).toBe('LOSSY');
    expect(file()).not.toContain(`${path.sep}public${path.sep}`);
    expect(await hasFullDerivative(ORG, T, root)).toBe(true);
    expect(await ensureFullDerivative(ORG, T, '/uploads/orgs/a/tracks/1.wav', { root, cut })).toBe(true);
    expect(cut).toHaveBeenCalledTimes(1);
    expect(readMaster).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.dirname(file()))).toEqual([`${T}.mp3`]);
  });
  it('two simultaneous requests share one cut', async () => {
    const { ensureFullDerivative } = await lib();
    const cut = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return Buffer.from('LOSSY');
    });
    const both = await Promise.all([ensureFullDerivative(ORG, T, '/uploads/a.wav', { root, cut }), ensureFullDerivative(ORG, T, '/uploads/a.wav', { root, cut })]);
    expect(both).toEqual([true, true]);
    expect(cut).toHaveBeenCalledTimes(1);
  });
  it('is false — and writes nothing — when ffmpeg gives nothing back: the master is never the fallback', async () => {
    const { ensureFullDerivative, hasFullDerivative } = await lib();
    expect(await ensureFullDerivative(ORG, T, '/uploads/a.wav', { root, cut: async () => null })).toBe(false);
    expect(await ensureFullDerivative(ORG, T, '/uploads/a.wav', { root, cut: async () => Buffer.alloc(0) })).toBe(false);
    expect(await hasFullDerivative(ORG, T, root)).toBe(false);
  });
  it('refuses a master outside the private storage, a missing one, and ids that are not UUIDs', async () => {
    const { ensureFullDerivative } = await lib();
    const cut = vi.fn(async () => Buffer.from('LOSSY'));
    expect(await ensureFullDerivative(ORG, T, 'r2://pub/anything.wav', { root, cut })).toBe(false);
    expect(await ensureFullDerivative(ORG, T, null, { root, cut })).toBe(false);
    expect(await ensureFullDerivative(ORG, '../x', '/uploads/a.wav', { root, cut })).toBe(false);
    expect(await ensureFullDerivative('nope', T, '/uploads/a.wav', { root, cut })).toBe(false);
    expect(cut).not.toHaveBeenCalled();
    expect(readMaster).not.toHaveBeenCalled();
  });
});

describe('openFullDerivative: never the whole file in one response', () => {
  const SIZE = 3 * CAP + 123;
  beforeEach(() => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), Buffer.alloc(SIZE, 7));
  });

  it('no Range header: 206 with the first bounded chunk', async () => {
    const { openFullDerivative } = await lib();
    const res = (await openFullDerivative(ORG, T, null, { root }))!;
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-${CAP - 1}/${SIZE}`);
    expect(res.headers.get('content-length')).toBe(String(CAP));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect((await body(res)).length).toBe(CAP);
  });
  it('an open-ended and an oversized Range are bounded too', async () => {
    const { openFullDerivative } = await lib();
    for (const range of ['bytes=0-', `bytes=0-${SIZE - 1}`, 'bytes=-99999999']) {
      const res = (await openFullDerivative(ORG, T, range, { root }))!;
      expect(res.status).toBe(206);
      const got = await body(res);
      expect(got.length).toBeLessThanOrEqual(CAP);
      expect(got.length).toBeLessThan(SIZE);
    }
  });
  it('a small Range is honoured exactly, and the real bytes come back', async () => {
    const { openFullDerivative } = await lib();
    fs.writeFileSync(file(), Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251)));
    const res = (await openFullDerivative(ORG, T, 'bytes=10-19', { root }))!;
    expect(res.headers.get('content-range')).toBe(`bytes 10-19/${SIZE}`);
    expect([...(await body(res))]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });
  it('the tail of the file is reachable in chunks, so the whole song plays', async () => {
    const { openFullDerivative } = await lib();
    let start = 0;
    let total = 0;
    for (let i = 0; i < 10 && start < SIZE; i += 1) {
      const res = (await openFullDerivative(ORG, T, `bytes=${start}-`, { root }))!;
      const got = await body(res);
      total += got.length;
      start += got.length;
    }
    expect(total).toBe(SIZE);
  });
  it('a start past the end is 416 with the size; a missing derivative is null', async () => {
    const { openFullDerivative } = await lib();
    const res = (await openFullDerivative(ORG, T, `bytes=${SIZE}-`, { root }))!;
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
    expect(await openFullDerivative(ORG, '50000000-0000-4000-8000-0000000000ff', null, { root })).toBeNull();
    expect(await openFullDerivative('nope', T, null, { root })).toBeNull();
  });
});
