import { describe, expect, it } from 'vitest';
import { beatsBySong, orderedBeatIds, replaceMainBeat, songBeatRows } from './song-beats';

describe('orderedBeatIds', () => {
  it('puts the main beat first and drops duplicates', () => {
    expect(orderedBeatIds([{ beat_track_id: 'b', position: 1 }, { beat_track_id: 'a', position: 0 }], 'a')).toEqual(['a', 'b']);
    expect(orderedBeatIds([{ beat_track_id: 'b', position: 0 }], 'a')).toEqual(['a', 'b']);
  });
  it('falls back to the main beat alone before mig 132', () => {
    expect(orderedBeatIds([], 'a')).toEqual(['a']);
    expect(orderedBeatIds([], null)).toEqual([]);
  });
});

describe('beatsBySong', () => {
  it('groups rows per song', () => {
    const m = beatsBySong(
      [{ song_track_id: 's1', beat_track_id: 'b2', position: 1 }, { song_track_id: 's1', beat_track_id: 'b1', position: 0 }],
      [{ id: 's1', beat_track_id: 'b1' }, { id: 's2', beat_track_id: 'b9' }],
    );
    expect(m.get('s1')).toEqual(['b1', 'b2']);
    expect(m.get('s2')).toEqual(['b9']);
  });
});

describe('replaceMainBeat', () => {
  it('swaps the main and keeps the rest in order', () => {
    expect(replaceMainBeat(['a', 'b', 'c'], 'a', 'd')).toEqual(['d', 'b', 'c']);
    expect(replaceMainBeat(['a', 'b', 'c'], 'a', 'c')).toEqual(['c', 'b']);
  });
  it('clearing the main clears the list', () => {
    expect(replaceMainBeat(['a', 'b'], 'a', null)).toEqual([]);
  });
});

describe('songBeatRows', () => {
  it('numbers positions and never lists the song itself', () => {
    expect(songBeatRows('s', 'u', ['a', 's', 'b', 'a'])).toEqual([
      { song_track_id: 's', beat_track_id: 'a', user_id: 'u', position: 0 },
      { song_track_id: 's', beat_track_id: 'b', user_id: 'u', position: 1 },
    ]);
  });
});
