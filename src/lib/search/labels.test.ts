import { describe, expect, it } from 'vitest';
import { songArtistNames, trackSearchSub } from './labels';

const names = new Map([['c1', 'Artist #1'], ['c2', 'Engineer'], ['c3', 'Artist #3']]);

describe('songArtistNames', () => {
  it('prefers the credited contact, then the project artist', () => {
    const out = songArtistNames({
      songIds: ['s1', 's2', 's3'],
      credits: [{ track_id: 's1', contact_id: 'c3' }, { track_id: 's2', contact_id: null }],
      projectTracks: [
        { project_id: 'p1', track_id: 's1' },
        { project_id: 'p1', track_id: 's2' },
        { project_id: 'p9', track_id: 's3' },
      ],
      links: [
        { project_id: 'p1', contact_id: 'c2', role: 'engineer', created_at: '2026-09-01T00:00:00Z' },
        { project_id: 'p1', contact_id: 'c1', role: 'artist', created_at: '2026-09-05T00:00:00Z' },
      ],
      contactNames: names,
    });
    expect(out.get('s1')).toBe('Artist #3');
    expect(out.get('s2')).toBe('Artist #1');
    expect(out.has('s3')).toBe(false);
  });
  it('ignores tracks that are not songs', () => {
    const out = songArtistNames({
      songIds: [],
      credits: [{ track_id: 'b1', contact_id: 'c1' }],
      projectTracks: [],
      links: [],
      contactNames: names,
    });
    expect(out.size).toBe(0);
  });
});

describe('trackSearchSub', () => {
  it('labels the kind and the artist', () => {
    expect(trackSearchSub('song', 'Artist #1')).toBe('SONG · Artist #1');
    expect(trackSearchSub('beat', null)).toBe('BEAT');
    expect(trackSearchSub(null, undefined)).toBe('TRACK');
  });
});
