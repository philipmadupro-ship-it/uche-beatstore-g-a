import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { ALS_MAX_OUTPUT_BYTES, boundedGunzip, readAlsMetadata, readDawMetadata, readFlpMetadata, readRppMetadata } from './daw-meta';
import { alsFixture, flpFixture, rppFixture } from './mocks/daw-fixtures';

describe('FL Studio', () => {
  it('reads the version and the fine tempo', () => {
    expect(readFlpMetadata(flpFixture({ version: '21.2.3.3586', bpm: 140 }))).toEqual({ app: 'FL Studio', appVersion: '21.2.3.3586', bpm: 140 });
  });
  it('keeps a fractional tempo and falls back to the whole-BPM word', () => {
    expect(readFlpMetadata(flpFixture({ bpm: 127.5 }))?.bpm).toBe(127.5);
    expect(readFlpMetadata(flpFixture({ legacyBpm: 90 }))?.bpm).toBe(90);
  });
  it('says nothing it cannot read: nulls, never a guess', () => {
    expect(readFlpMetadata(flpFixture())).toEqual({ app: 'FL Studio', appVersion: null, bpm: null });
    expect(readFlpMetadata(flpFixture({ bpm: 5 }))?.bpm).toBeNull(); // out of range
    expect(readFlpMetadata(flpFixture({ version: 'not a version' }))?.appVersion).toBeNull();
  });
  it('is null for a file that is not an FLP, and survives truncation', () => {
    expect(readFlpMetadata(new Uint8Array(Buffer.from('hello world, not an flp')))).toBeNull();
    const full = flpFixture({ version: '21.0.0.1', bpm: 100 });
    expect(() => readFlpMetadata(full.subarray(0, 25))).not.toThrow();
    expect(readFlpMetadata(full.subarray(0, 10))).toBeNull();
  });
  it('bounds the event walk on a hostile file', () => {
    const hdr = flpFixture();
    const junk = new Uint8Array(hdr.length + 200_000).fill(0x01);
    junk.set(hdr);
    expect(() => readFlpMetadata(junk)).not.toThrow();
  });
});

describe('Ableton', () => {
  it('reads the creator version and the master tempo', async () => {
    expect(await readAlsMetadata(alsFixture({ creator: 'Ableton Live 11.0.12', bpm: 128 }))).toEqual({ app: 'Ableton Live', appVersion: '11.0.12', bpm: 128 });
  });
  it('never returns names or paths from inside the set', async () => {
    const json = JSON.stringify(await readAlsMetadata(alsFixture()));
    expect(json).not.toMatch(/Secret|kick|Users|Samples/);
  });
  it('is null for non-gzip input', async () => {
    expect(await readAlsMetadata(new Uint8Array(Buffer.from('plain')))).toBeNull();
  });
  it('a gzip bomb is cut at the output cap, quickly', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(200 * 1024 * 1024, 0x20)); // 200 MB of spaces, a few hundred KB packed
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const t = Date.now();
    const out = await boundedGunzip(bomb, 1024 * 1024);
    expect(out.length).toBeLessThanOrEqual(1024 * 1024);
    expect(Date.now() - t).toBeLessThan(3000);
    const meta = await readAlsMetadata(new Uint8Array(bomb));
    expect(meta).toEqual({ app: 'Ableton Live', appVersion: null, bpm: null });
    expect(ALS_MAX_OUTPUT_BYTES).toBe(4 * 1024 * 1024);
  });
  it('corrupt or truncated gzip does not throw', async () => {
    const good = alsFixture();
    await expect(readAlsMetadata(good.subarray(0, 30))).resolves.toBeDefined();
    const bad = new Uint8Array(good);
    bad[20] ^= 0xff;
    await expect(readAlsMetadata(bad)).resolves.toBeDefined();
  });
});

describe('Reaper', () => {
  it('reads the version and tempo and nothing else', () => {
    expect(readRppMetadata(rppFixture({ version: '6.80', bpm: 140 }))).toEqual({ app: 'Reaper', appVersion: '6.80', bpm: 140 });
    expect(JSON.stringify(readRppMetadata(rppFixture()))).not.toMatch(/Secret|snare|home/);
  });
  it('is null for a file that is not an RPP', () => {
    expect(readRppMetadata(new Uint8Array(Buffer.from('nope')))).toBeNull();
  });
});

describe('readDawMetadata', () => {
  it('dispatches by extension; Pro Tools and Cubase say only which app', async () => {
    expect(await readDawMetadata('flp', flpFixture({ bpm: 100 }))).toMatchObject({ bpm: 100 });
    expect(await readDawMetadata('ptx', new Uint8Array(4))).toEqual({ app: 'Pro Tools', appVersion: null, bpm: null });
    expect(await readDawMetadata('cpr', new Uint8Array(4))).toEqual({ app: 'Cubase', appVersion: null, bpm: null });
    expect(await readDawMetadata('wav', new Uint8Array(4))).toBeNull();
  });
});
