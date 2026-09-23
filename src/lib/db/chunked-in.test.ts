import { describe, expect, it, vi } from 'vitest';
import { chunkIds, ID_CHUNK, selectIn } from './chunked-in';

describe('chunkIds', () => {
  it('splits at the cap and keeps the remainder', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('returns nothing for an empty list', () => {
    expect(chunkIds([])).toEqual([]);
  });

  it('keeps every chunk within the cap', () => {
    const ids = Array.from({ length: 651 }, (_, i) => `id-${i}`);
    expect(chunkIds(ids).every((c) => c.length <= ID_CHUNK)).toBe(true);
  });
});

describe('selectIn', () => {
  it('merges rows across chunks without losing any', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const build = vi.fn(async (slice: string[]) => ({
      data: slice.map((id) => ({ id })),
      error: null,
    }));
    const rows = await selectIn(build, ids);
    expect(build).toHaveBeenCalledTimes(3);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });

  it('skips the query entirely for an empty id list', async () => {
    const build = vi.fn();
    expect(await selectIn(build, [])).toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it('rethrows rather than returning a partial list', async () => {
    // A short list that looks complete reads as "those rows were deleted".
    const build = vi.fn(async (slice: string[]) =>
      slice[0] === 'id-100'
        ? { data: null, error: new Error('Bad Request') }
        : { data: slice.map((id) => ({ id })), error: null },
    );
    await expect(selectIn(build, Array.from({ length: 150 }, (_, i) => `id-${i}`)))
      .rejects.toThrow('Bad Request');
  });

  it('tolerates a chunk that returns null data', async () => {
    const build = vi.fn(async () => ({ data: null, error: null }));
    expect(await selectIn(build, ['a', 'b'])).toEqual([]);
  });
});
