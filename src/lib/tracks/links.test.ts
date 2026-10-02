import { describe, expect, it } from 'vitest';
import { bundleFileNames, bundleReadme, isStoredRelation, linkLabel, linkSearchParams, mergeLinks, rankCandidates, relationChoices, suggestRelation } from './links';
import { TrackLinkBodySchema, TrackUnlinkBodySchema } from '@/lib/contracts';

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

describe('the Linked picker', () => {
  it('reads a type word as the type, anything else as a title search', () => {
    expect(Object.fromEntries(linkSearchParams('loops', 'auto'))).toEqual({ limit: '40', lean: '1', type: 'loop' });
    expect(Object.fromEntries(linkSearchParams(' Topline ', 'auto'))).toEqual({ limit: '40', lean: '1', type: 'topline' });
    expect(Object.fromEntries(linkSearchParams('pad loop', 'auto'))).toEqual({ limit: '40', lean: '1', q: 'pad loop' });
  });
  it('asks for recent tracks when nothing is typed, narrowed by a picked relation', () => {
    expect(Object.fromEntries(linkSearchParams('', 'auto'))).toEqual({ limit: '40', lean: '1' });
    expect(Object.fromEntries(linkSearchParams('', 'instrumental'))).toEqual({ limit: '40', lean: '1', type: 'instrumental' });
    expect(Object.fromEntries(linkSearchParams('', 'version'))).toEqual({ limit: '40', lean: '1' });
  });
  it('puts the types that fit first and keeps server order within a type', () => {
    const rows = [{ id: 'a', type: 'song' }, { id: 'b', type: 'loop' }, { id: 'c', type: 'beat' }, { id: 'd', type: 'loop' }];
    expect(rankCandidates('song', rows).map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(rankCandidates('beat', rows).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('master / demo (Label OS, mig 140)', () => {
  const lt = new Map([t('song', 'song'), t('b1', 'beat'), t('mst', 'song'), t('dmo', 'song'), t('inst', 'instrumental'), t('loop', 'loop')].map((x) => [x.id, x]));

  it('reads master and demo links, labelled from both sides, in display order', () => {
    const items = mergeLinks('song', {
      mainBeatId: 'b1',
      songBeats: [],
      links: [
        { from_track_id: 'song', to_track_id: 'dmo', relation: 'demo', position: 0 },
        { from_track_id: 'song', to_track_id: 'loop', relation: 'loop', position: 0 },
        { from_track_id: 'song', to_track_id: 'mst', relation: 'master', position: 0 },
        { from_track_id: 'song', to_track_id: 'inst', relation: 'instrumental', position: 0 },
      ],
    }, lt);
    expect(items.map((i) => [linkLabel(i.relation, i.direction), i.track.id])).toEqual([
      ['Beat', 'b1'], ['Master', 'mst'], ['Instrumental', 'inst'], ['Loop', 'loop'], ['Demo', 'dmo'],
    ]);
    const fromMaster = mergeLinks('mst', { songBeats: [], links: [{ from_track_id: 'song', to_track_id: 'mst', relation: 'master', position: 0 }] }, lt);
    expect(fromMaster.map((i) => linkLabel(i.relation, i.direction))).toEqual(['Master of']);
    const fromDemo = mergeLinks('dmo', { songBeats: [], links: [{ from_track_id: 'song', to_track_id: 'dmo', relation: 'demo', position: 0 }] }, lt);
    expect(fromDemo.map((i) => linkLabel(i.relation, i.direction))).toEqual(['Demo of']);
  });

  it('leaves the order of the existing relations exactly as before', () => {
    const fromBeat = mergeLinks('b1', {
      songBeats: [{ song_track_id: 'song', beat_track_id: 'b1', position: 0 }],
      links: [{ from_track_id: 'b1', to_track_id: 'loop', relation: 'loop', position: 0 }, { from_track_id: 'b1', to_track_id: 'top', relation: 'topline', position: 0 }],
    }, tracks);
    expect(fromBeat.map((i) => [linkLabel(i.relation, i.direction), i.track.id])).toEqual([['Topline', 'top'], ['Loop', 'loop'], ['Song on it', 'song']]);
  });

  it('never guesses master or demo: both are audio of the song, the type cannot tell them apart', () => {
    for (const from of ['song', 'beat', 'loop', 'topline', 'instrumental', 'remix', null]) {
      for (const to of ['song', 'beat', 'loop', 'topline', 'instrumental', 'remix', null]) {
        expect(['master', 'demo']).not.toContain(suggestRelation(from, to));
      }
    }
  });

  it("keeps the producer's relation choices unchanged; Label OS songs add master and demo", () => {
    expect(relationChoices('song')).toEqual(['beat', 'instrumental', 'topline', 'loop', 'version']);
    expect(relationChoices('beat')).toEqual(['loop', 'topline', 'instrumental', 'version']);
    expect(relationChoices('song', { labelOs: true })).toEqual(['beat', 'master', 'instrumental', 'topline', 'loop', 'version', 'demo']);
    expect(relationChoices('beat', { labelOs: true })).toEqual(['loop', 'topline', 'instrumental', 'version']);
  });

  it('ranks songs first in the picker for a master or a demo, and leaves every other ranking alone', () => {
    const rows = [{ id: 'a', type: 'song' }, { id: 'b', type: 'loop' }, { id: 'c', type: 'beat' }, { id: 'd', type: 'loop' }];
    expect(rankCandidates('song', rows, 'master').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rankCandidates('song', rows, 'demo').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rankCandidates('song', rows, 'auto').map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(rankCandidates('song', rows, 'loop').map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('does not narrow the picker by type for a master or a demo', () => {
    expect(Object.fromEntries(linkSearchParams('', 'master'))).toEqual({ limit: '40', lean: '1' });
    expect(Object.fromEntries(linkSearchParams('', 'demo'))).toEqual({ limit: '40', lean: '1' });
  });

  it('stores master and demo in track_links', () => {
    expect(isStoredRelation('master')).toBe(true);
    expect(isStoredRelation('demo')).toBe(true);
    expect(isStoredRelation('beat')).toBe(false);
  });
});

describe('the producer link route (unchanged by Label OS)', () => {
  it('still accepts exactly the five producer relations, so it cannot write a master or a demo', () => {
    const body = (relation: string) => TrackLinkBodySchema.safeParse({ track_id: '0b0e1a57-0000-4000-8000-000000000001', relation });
    for (const r of ['beat', 'instrumental', 'loop', 'topline', 'version']) expect(body(r).success).toBe(true);
    expect(body('master').success).toBe(false);
    expect(body('demo').success).toBe(false);
  });
  it('can still remove any link the drawer shows, master and demo included', () => {
    const body = (relation: string) => TrackUnlinkBodySchema.safeParse({ track_id: '0b0e1a57-0000-4000-8000-000000000001', relation });
    for (const r of ['beat', 'instrumental', 'loop', 'topline', 'version', 'master', 'demo']) expect(body(r).success).toBe(true);
    expect(body('stem').success).toBe(false);
  });
});
