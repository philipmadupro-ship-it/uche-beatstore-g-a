import { describe, expect, it } from 'vitest';

import {
  MAX_ACCUMULATED_TRACKS,
  canLoadMore,
  isCurrentRequest,
  mergeLoadedPage,
} from './load-more';

const tracks = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `t${from + i}` }));

describe('mergeLoadedPage', () => {
  it('appends a page after what is already showing', () => {
    const merged = mergeLoadedPage(tracks(0, 3), tracks(3, 2));
    expect(merged.tracks.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    expect(merged.capped).toBe(false);
  });

  it('drops a row the server handed back on two consecutive pages', () => {
    // Offset pagination over a catalogue that changes underneath it can
    // repeat a row across a page boundary.
    const merged = mergeLoadedPage(tracks(0, 3), [{ id: 't2' }, { id: 't3' }]);
    expect(merged.tracks.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3']);
  });

  it('keeps first-seen order, so nothing on screen jumps', () => {
    const merged = mergeLoadedPage([{ id: 'b' }, { id: 'a' }], [{ id: 'a' }, { id: 'c' }]);
    expect(merged.tracks.map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('never grows past the cap', () => {
    const merged = mergeLoadedPage(tracks(0, 390), tracks(390, 80));
    expect(merged.tracks).toHaveLength(MAX_ACCUMULATED_TRACKS);
    expect(merged.capped).toBe(true);
  });

  it('fills a page that straddles the cap up to it, rather than refusing it', () => {
    const merged = mergeLoadedPage(tracks(0, 390), tracks(390, 80));
    // 10 of the 80 fit; they are taken, not discarded.
    expect(merged.tracks[MAX_ACCUMULATED_TRACKS - 1].id).toBe('t399');
  });

  it('reports capped exactly at the limit', () => {
    expect(mergeLoadedPage(tracks(0, 400), []).capped).toBe(true);
    expect(mergeLoadedPage(tracks(0, 399), []).capped).toBe(false);
  });

  it('skips rows with no id rather than keying them all as one', () => {
    type Row = { id?: string | null };
    const merged = mergeLoadedPage<Row>([{ id: null }, { id: 'a' }], [{ id: undefined }]);
    expect(merged.tracks.map((t) => t.id)).toEqual(['a']);
  });

  it('honours an explicit cap', () => {
    expect(mergeLoadedPage(tracks(0, 10), tracks(10, 10), 15).tracks).toHaveLength(15);
  });
});

describe('canLoadMore', () => {
  const more = { hasMore: true, nextCursor: '80' };

  it('offers another page while there is one and room for it', () => {
    expect(canLoadMore(more, 80)).toBe(true);
  });

  it('stops when the server says the catalogue is exhausted', () => {
    expect(canLoadMore({ hasMore: false, nextCursor: null }, 80)).toBe(false);
  });

  it('stops at the cap even though the server has more', () => {
    // The cap, not the catalogue, is what ends it — the page then offers the
    // filters instead of another page.
    expect(canLoadMore(more, MAX_ACCUMULATED_TRACKS)).toBe(false);
  });

  it('does not retry when the server claims more but sent no cursor', () => {
    expect(canLoadMore({ hasMore: true, nextCursor: null }, 80)).toBe(false);
  });
});

describe('isCurrentRequest', () => {
  it('accepts a response to the query still on screen', () => {
    expect(isCurrentRequest('limit=80&genre=trap', 'limit=80&genre=trap')).toBe(true);
  });

  it('rejects a response to a query the buyer has since changed', () => {
    // The race: a load-more for Afrobeats resolving after the buyer switched
    // to Trap must not append Afrobeats to the Trap results.
    expect(isCurrentRequest('limit=80&genre=afrobeats', 'limit=80&genre=trap')).toBe(false);
  });
});
