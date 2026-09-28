import { describe, expect, it } from 'vitest';
import {
  buildBuyerLibraryShape,
  buyerPlaylistMembership,
  collectBuyerLibraryTrackIds,
  playlistNameFromTrack,
  purchasedTrackIdSet,
  visibleBuyerLibraryTracks,
  type BuyerLibraryTrackSummary,
} from './buyer-library';

const track = (id: string, title: string): BuyerLibraryTrackSummary => ({
  id,
  title,
  cover_url: null,
  type: 'beat',
  bpm: 140,
  key: 'A',
  scale: 'minor',
  duration_seconds: 142,
});

describe('buyer library shaping', () => {
  it('collects unique track ids across history, favorites, and playlists', () => {
    expect(collectBuyerLibraryTrackIds({
      history: [{ track_id: 'a' }, { track_id: 'b' }],
      favorites: [{ track_id: 'a' }],
      playlistTracks: [{ track_id: 'c' }, { track_id: 'b' }],
    })).toEqual(['a', 'b', 'c']);
  });

  it('attaches safe track summaries while preserving missing track rows', () => {
    const shaped = buildBuyerLibraryShape({
      email: 'buyer@example.test',
      history: [
        { track_id: 'a', played_at: '2026-07-25T01:00:00Z' },
        { track_id: 'missing', played_at: '2026-07-25T00:00:00Z' },
      ],
      favorites: [{ track_id: 'b', created_at: '2026-07-24T00:00:00Z' }],
      playlists: [{ id: 'p1', name: 'Writing', created_at: '2026-07-23T00:00:00Z', updated_at: '2026-07-25T00:00:00Z' }],
      playlistTracks: [
        { playlist_id: 'p1', track_id: 'b', position: 0 },
        { playlist_id: 'p1', track_id: 'a', position: 1 },
      ],
      tracks: [track('a', 'After Hours'), track('b', 'Basement Run')],
    });

    expect(shaped.history.map((row) => row.track?.title ?? null)).toEqual(['After Hours', null]);
    expect(shaped.favorites[0].track?.title).toBe('Basement Run');
    expect(shaped.playlists[0].track_ids).toEqual(['b', 'a']);
    expect(shaped.playlists[0].tracks.map((item) => item.title)).toEqual(['Basement Run', 'After Hours']);
  });
});

describe('visibleBuyerLibraryTracks', () => {
  const t = (id: string, store_listed: boolean | null) => ({
    id, title: id, cover_url: null, type: null, bpm: null, key: null, scale: null, duration_seconds: null, store_listed,
  });

  it('keeps listed beats and drops unlisted ones the buyer never bought', () => {
    const out = visibleBuyerLibraryTracks([t('listed', true), t('private', false), t('unknown', null)], new Set());
    expect(out.map((x) => x.id)).toEqual(['listed']);
  });

  it('keeps an unlisted beat this buyer paid for (an exclusive delists it)', () => {
    const out = visibleBuyerLibraryTracks([t('bought', false)], new Set(['bought']));
    expect(out.map((x) => x.id)).toEqual(['bought']);
  });

  it('never leaks the store_listed flag into the response shape', () => {
    const [out] = visibleBuyerLibraryTracks([t('listed', true)], new Set());
    expect(out).not.toHaveProperty('store_listed');
  });
});

describe('purchasedTrackIdSet', () => {
  it('flattens track_ids arrays and ignores malformed rows', () => {
    expect([...purchasedTrackIdSet([{ track_ids: ['a', 'b'] }, { track_ids: null }, { track_ids: ['b', 3] }, {}])])
      .toEqual(['a', 'b']);
  });
});

describe('buyerPlaylistMembership', () => {
  it('marks the playlists that already hold the track', () => {
    expect(buyerPlaylistMembership([
      { id: 'p1', name: 'Late night', track_ids: ['x', 'y'] },
      { id: 'p2', name: 'Gym', track_ids: [] },
    ], 'x')).toEqual([
      { id: 'p1', name: 'Late night', contains: true, count: 2 },
      { id: 'p2', name: 'Gym', contains: false, count: 0 },
    ]);
  });
});

describe('playlistNameFromTrack', () => {
  it('names the playlist after the beat, within the 80-char limit', () => {
    expect(playlistNameFromTrack('  Night Shift ')).toBe('Night Shift');
    expect(playlistNameFromTrack('x'.repeat(120))).toHaveLength(80);
    expect(playlistNameFromTrack(null)).toBe('My playlist');
    expect(playlistNameFromTrack('   ')).toBe('My playlist');
  });
});
