import { describe, it, expect, vi } from 'vitest';
import { chunkIds, selectInChunks, IN_CHUNK_SIZE } from './db-in-chunks';

describe('chunkIds', () => {
  it('splits into batches of the given size', () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns one batch when everything fits', () => {
    expect(chunkIds(['a', 'b'], 10)).toEqual([['a', 'b']]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunkIds([], 10)).toEqual([]);
  });

  it('rejects a nonsensical size instead of looping forever', () => {
    expect(() => chunkIds([1, 2], 0)).toThrow();
  });
});

describe('selectInChunks', () => {
  it('issues no request at all for an empty id list', async () => {
    const q = vi.fn();
    await expect(selectInChunks([], q)).resolves.toEqual([]);
    expect(q).not.toHaveBeenCalled();
  });

  it('keeps every batch under the size limit and concatenates the rows', async () => {
    // 651 ids is the real case that broke /api/tracks/store-summary.
    const ids = Array.from({ length: 651 }, (_, i) => `id-${i}`);
    const seen: number[] = [];
    const rows = await selectInChunks(ids, (batch) => {
      seen.push(batch.length);
      return Promise.resolve({ data: batch.map((id) => ({ id })), error: null });
    });
    expect(seen.every((n) => n <= IN_CHUNK_SIZE)).toBe(true);
    expect(seen.reduce((a, b) => a + b, 0)).toBe(651);
    expect(rows).toHaveLength(651);
    expect(rows[0]).toEqual({ id: 'id-0' });
    expect(rows[650]).toEqual({ id: 'id-650' });
  });

  it('throws on the first batch error, matching caller expectations', async () => {
    await expect(
      selectInChunks(['a'], () => Promise.resolve({ data: null, error: { message: 'Bad Request' } })),
    ).rejects.toThrow('Bad Request');
  });

  it('tolerates a batch returning null data', async () => {
    await expect(
      selectInChunks(['a'], () => Promise.resolve({ data: null, error: null })),
    ).resolves.toEqual([]);
  });
});
