import { describe, it, expect, vi } from 'vitest';
import {
  STEM_SETTINGS_VERSION, lookupStemCache, pruneStemCache, stemCacheKey, stemFingerprint, supersededStemKeys, type StemCacheDeps,
} from './cache';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SRC = 'r2://priv/tracks/a.wav';
const NEW = 'r2://priv/tracks/b.wav';
const all = (id: string, src: string) => (['vocals', 'drums', 'bass', 'other'] as const).map((s) => stemCacheKey(id, src, s));

describe('fingerprint and keys', () => {
  it('is stable, 12 hex, and changes with source, model or settings', () => {
    expect(stemFingerprint(SRC)).toBe(stemFingerprint(SRC));
    expect(stemFingerprint(SRC)).toMatch(/^[0-9a-f]{12}$/);
    expect(stemFingerprint(NEW)).not.toBe(stemFingerprint(SRC));
    expect(stemFingerprint(SRC, 'other-model')).not.toBe(stemFingerprint(SRC));
    expect(stemFingerprint(SRC, undefined, 'v2')).not.toBe(stemFingerprint(SRC));
    expect(STEM_SETTINGS_VERSION).toBe('v1');
  });
  it('never shares a key between tracks', () => {
    expect(stemCacheKey(A, SRC, 'vocals')).not.toBe(stemCacheKey(B, SRC, 'vocals'));
  });
});

describe('supersededStemKeys', () => {
  it('names only this track\'s other-fingerprint entries', () => {
    const listed = [...all(A, SRC), ...all(A, NEW)];
    expect(supersededStemKeys(listed, A, NEW).sort()).toEqual(all(A, SRC).sort());
    expect(supersededStemKeys(listed, A, null).sort()).toEqual(listed.sort());
  });
  it('never matches another track, masters, manual stems, pre-cache stems or a bad id', () => {
    const foreign = [
      ...all(B, SRC),
      `tracks/${A}-abcdef123456.wav`,
      `stems/${A}-vocals.wav`,
      `stems/${A}-abcdef123456/vocals.wav`,
      `deliverables/${A}-abcdef123456.mp3`,
      `stem-cache/${A}-abcdef123456/vocals.mp3`,
      `stem-cache/${A}-abcdef123456/vocals.wav/extra`,
      `stem-cache/${A}-abcdef123456/piano.wav`,
      `stem-cache/${A}-short/vocals.wav`,
      'r2://priv/Night Drive - Vocals.wav', // an old random-keyed stem, still referenced by its row
      'uploads/abc123_stem.wav',
    ];
    expect(supersededStemKeys(foreign, A, null)).toEqual([]);
    expect(supersededStemKeys(all(A, SRC), 'not-a-uuid', null)).toEqual([]);
    expect(supersededStemKeys(all(A, SRC), '.*', null)).toEqual([]);
  });
});

describe('pruneStemCache', () => {
  it('removes the superseded keys and keeps the current', async () => {
    const remove = vi.fn(async () => {});
    const n = await pruneStemCache({ id: A, source: NEW }, { list: async () => [...all(A, SRC), ...all(A, NEW)], remove });
    expect(n).toBe(4);
    expect(remove).toHaveBeenCalledWith(all(A, SRC));
  });
  it('never throws and removes nothing when listing fails', async () => {
    const remove = vi.fn();
    expect(await pruneStemCache({ id: A, source: NEW }, { list: async () => { throw new Error('x'); }, remove })).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
  it('swallows a failed delete', async () => {
    expect(await pruneStemCache({ id: A, source: null }, { list: async () => all(A, SRC), remove: async () => { throw new Error('x'); } })).toBe(0);
  });
});

describe('lookupStemCache', () => {
  const mk = (present: (k: string) => boolean, off = false): StemCacheDeps => ({
    refFor: (k) => (off ? null : `r2://priv/${k}`),
    exists: async (ref) => present(ref.replace('r2://priv/', '')),
    put: async (k) => `r2://priv/${k}`,
    prune: async () => 0,
  });
  it('hits only when all four current objects exist', async () => {
    const keys = new Set(all(A, SRC));
    expect(await lookupStemCache(mk((k) => keys.has(k)), A, SRC)).toMatchObject({ vocals: `r2://priv/${all(A, SRC)[0]}` });
    expect(await lookupStemCache(mk((k) => keys.has(k) && !k.endsWith('bass.wav')), A, SRC)).toBeNull();
    expect(await lookupStemCache(mk((k) => keys.has(k)), A, NEW)).toBeNull();
    expect(await lookupStemCache(mk((k) => keys.has(k)), B, SRC)).toBeNull();
  });
  it('misses without storage or when the probe throws', async () => {
    expect(await lookupStemCache(mk(() => true, true), A, SRC)).toBeNull();
    const boom: StemCacheDeps = { ...mk(() => true), exists: async () => { throw new Error('r2'); } };
    expect(await lookupStemCache(boom, A, SRC)).toBeNull();
  });
});
