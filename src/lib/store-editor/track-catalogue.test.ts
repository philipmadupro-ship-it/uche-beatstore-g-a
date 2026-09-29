import { describe, expect, it } from 'vitest';
import { fetchAllTrackPages, mapWithConcurrency, TRACK_PAGE_SIZE, type TrackPage } from './track-catalogue';

type Row = { id: string };

/** Mimics `/api/tracks?paged=1`: offset cursor, 100-row ceiling. */
function pagedApi(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `t${i}` }));
  const cursors: Array<string | null> = [];
  const fetchPage = async (cursor: string | null): Promise<TrackPage<Row>> => {
    cursors.push(cursor);
    const offset = Number(cursor ?? 0);
    const page = rows.slice(offset, offset + TRACK_PAGE_SIZE);
    const hasMore = offset + TRACK_PAGE_SIZE < rows.length;
    return { tracks: page, pageInfo: { hasMore, nextCursor: hasMore ? String(offset + TRACK_PAGE_SIZE) : null } };
  };
  return { fetchPage, cursors };
}

describe('fetchAllTrackPages', () => {
  it('loads a catalogue larger than one page — not just the newest 100', async () => {
    const api = pagedApi(250);
    const result = await fetchAllTrackPages(api.fetchPage);
    expect(result.complete).toBe(true);
    expect(result.tracks).toHaveLength(250);
    expect(result.tracks.at(-1)?.id).toBe('t249');
    expect(api.cursors).toEqual([null, '100', '200']);
  });

  it('stops after one request for a small catalogue and for an empty one', async () => {
    const small = pagedApi(40);
    expect((await fetchAllTrackPages(small.fetchPage)).tracks).toHaveLength(40);
    expect(small.cursors).toEqual([null]);

    const empty = pagedApi(0);
    expect(await fetchAllTrackPages(empty.fetchPage)).toEqual({ tracks: [], complete: true });
  });

  it('handles an exact multiple of the page size without an extra empty page', async () => {
    const api = pagedApi(200);
    const result = await fetchAllTrackPages(api.fetchPage);
    expect(result.tracks).toHaveLength(200);
    expect(api.cursors).toEqual([null, '100']);
  });

  it('reports progress after each page', async () => {
    const api = pagedApi(230);
    const seen: number[] = [];
    await fetchAllTrackPages(api.fetchPage, { onPage: (rows) => seen.push(rows.length) });
    expect(seen).toEqual([100, 200, 230]);
  });

  it('drops a row repeated across pages', async () => {
    const pages: Record<string, TrackPage<Row>> = {
      start: { tracks: [{ id: 'a' }, { id: 'b' }], pageInfo: { hasMore: true, nextCursor: '2' } },
      '2': { tracks: [{ id: 'b' }, { id: 'c' }], pageInfo: { hasMore: false, nextCursor: null } },
    };
    const result = await fetchAllTrackPages(async (cursor) => pages[cursor ?? 'start']);
    expect(result.tracks.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('stops instead of looping on a cursor that does not advance', async () => {
    let calls = 0;
    const result = await fetchAllTrackPages(async () => {
      calls += 1;
      return { tracks: [{ id: `x${calls}` }], pageInfo: { hasMore: true, nextCursor: '100' } };
    });
    expect(result.complete).toBe(false);
    expect(calls).toBe(2);
  });

  it('reports an incomplete catalogue when the page limit is hit', async () => {
    const api = pagedApi(500);
    const result = await fetchAllTrackPages(api.fetchPage, { maxPages: 2 });
    expect(result).toMatchObject({ complete: false });
    expect(result.tracks).toHaveLength(200);
  });

  it('propagates a failed page', async () => {
    await expect(fetchAllTrackPages(async () => { throw new Error('Failed (500)'); })).rejects.toThrow('Failed (500)');
  });
});

describe('mapWithConcurrency', () => {
  it('keeps order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    });
    expect(out).toEqual(Array.from({ length: 30 }, (_, i) => i * 2));
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
