import { describe, expect, it } from 'vitest';
import { buildBuyerLibraryShape, collectBuyerLibraryTrackIds, type BuyerLibraryTrackSummary } from './buyer-library';

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
