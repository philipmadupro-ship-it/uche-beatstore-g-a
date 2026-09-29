import { describe, expect, it } from 'vitest';
import { bundleFileNames, bundleReadme, linkLabel, mergeLinks, relationChoices, suggestRelation } from './links';

const t = (id: string, type: string) => ({ id, title: id.toUpperCase(), type });
const tracks = new Map([t('song', 'song'), t('b1', 'beat'), t('b2', 'beat'), t('inst', 'instrumental'), t('loop', 'loop'), t('top', 'topline')].map((x) => [x.id, x]));

describe('mergeLinks', () => {
  it('reads song_beats and track_links as one list, grouped and ordered', () => {
    const items = mergeLinks('song', {
      mainBeatId: 'b1',
      songBeats: [{ song_track_id: 'song', beat_track_id: 'b2', position: 1 }, { song_track_id: 'song', beat_track_id: 'b1', position: 0 }],
      links: [
        { from_track_id: 'song', to_track_id: 'loop', relation: 'loop', position: 0 },
        { from_track_id: 'song', to_track_id: 'inst', relation: 'instrumental', position: 0 },
        { from_track_id: 'song', to_track_id: 'gone', relation: 'loop', position: 1 },
        { from_track_id: 'song', to_track_id: 'x', relation: 'nonsense', position: 0 },
      ],
    }, tracks);
    expect(items.map((i) => [i.relation, i.direction, i.track.id])).toEqual([
      ['beat', 'out', 'b1'], ['beat', 'out', 'b2'], ['instrumental', 'out', 'inst'], ['loop', 'out', 'loop'],
    ]);
  });
  it('shows the other side from a beat or a loop', () => {
    const fromBeat = mergeLinks('b1', {
      songBeats: [{ song_track_id: 'song', beat_track_id: 'b1', position: 0 }],
      links: [{ from_track_id: 'b1', to_track_id: 'loop', relation: 'loop', position: 0 }, { from_track_id: 'b1', to_track_id: 'top', relation: 'topline', position: 0 }],
    }, tracks);
    expect(fromBeat.map((i) => [linkLabel(i.relation, i.direction), i.track.id])).toEqual([['Topline', 'top'], ['Loop', 'loop'], ['Song on it', 'song']]);
    const fromLoop = mergeLinks('loop', { songBeats: [], links: [{ from_track_id: 'b1', to_track_id: 'loop', relation: 'loop', position: 0 }] }, tracks);
    expect(fromLoop.map((i) => linkLabel(i.relation, i.direction))).toEqual(['Used in']);
  });
  it('lists a track once even when linked twice', () => {
    const items = mergeLinks('song', { mainBeatId: 'b1', songBeats: [{ song_track_id: 'song', beat_track_id: 'b1', position: 0 }], links: [{ from_track_id: 'song', to_track_id: 'b1', relation: 'version', position: 0 }] }, tracks);
    expect(items).toHaveLength(1);
    expect(items[0].relation).toBe('beat');
  });
});

describe('suggestRelation / relationChoices', () => {
  it('guesses from the types', () => {
    expect(suggestRelation('song', 'beat')).toBe('beat');
    expect(suggestRelation('song', 'instrumental')).toBe('instrumental');
    expect(suggestRelation('beat', 'loop')).toBe('loop');
    expect(suggestRelation('beat', 'topline')).toBe('topline');
    expect(suggestRelation('beat', 'beat')).toBe('version');
  });
  it('offers "beat" only from a song', () => {
    expect(relationChoices('song')).toContain('beat');
    expect(relationChoices('beat')).not.toContain('beat');
  });
});

describe('zip naming', () => {
  it('numbers entries, labels them, keeps extensions, never duplicates', () => {
    const names = bundleFileNames(
      { title: 'Night/Drive', source: 'r2://b/x.WAV' },
      [
        { label: 'Beat', title: 'MIDNIGHT', source: '/uploads/a.mp3' },
        { label: 'Loop', title: 'Keys', source: 'r2://b/k' },
        { label: 'Loop', title: 'Keys', source: 'r2://b/k2' },
      ],
    );
    expect(names).toEqual(['01 Night Drive.wav', '02 Beat - MIDNIGHT.mp3', '03 Loop - Keys.wav', '04 Loop - Keys.wav']);
    expect(bundleFileNames({ title: 'A', source: 'x.wav' }, [{ label: 'x', title: 'A', source: 'y.wav' }, { label: 'x', title: 'A', source: 'z.wav' }].map((l, i) => ({ ...l, label: i ? 'x' : 'x' }))))
      .toEqual(['01 A.wav', '02 x - A.wav', '03 x - A.wav']);
  });
  it('writes a readme', () => {
    expect(bundleReadme('Song', [{ file: '01 Song.wav', label: 'This track' }])).toContain('01 Song.wav  (This track)');
  });
});
