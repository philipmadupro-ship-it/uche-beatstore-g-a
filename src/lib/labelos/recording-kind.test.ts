import { describe, expect, it } from 'vitest';
import { mergeLinks, type LinkTrack } from '@/lib/tracks/links';
import { audioCapabilityFor, recordingClass } from './capabilities';
import { recordingKindOf, songRecordings } from './recording-kind';

const song = { id: 'song', title: 'TRACK 04', type: 'song', song_stage: 'in_review' as const };

describe('recordingKindOf — every row of the 17 R1 mapping table', () => {
  // [material, track type, relation from the song, kind, class (for a song that is NOT selected)]
  const rows: Array<[string, string, Parameters<typeof recordingKindOf>[1], string, 'finished' | 'working']> = [
    ["song track's current audio", 'song', 'self', 'mix', 'working'],
    ['older track_versions row', 'song', 'track_version', 'mix', 'working'],
    ['version link', 'song', 'version', 'mix', 'working'],
    ['song_beats beat', 'beat', 'beat', 'beat_source', 'working'],
    ['loop link', 'loop', 'loop', 'loop', 'working'],
    ['topline link', 'topline', 'topline', 'topline', 'working'],
    ['instrumental link', 'instrumental', 'instrumental', 'instrumental', 'finished'],
    ['master link (new)', 'song', 'master', 'master', 'finished'],
    ['demo link (new)', 'song', 'demo', 'demo', 'working'],
    ['track type beat not linked to a song', 'beat', null, 'beat_source', 'working'],
  ];
  it.each(rows)('%s', (_label, type, relation, kind, cls) => {
    expect(recordingKindOf({ type }, relation)).toBe(kind);
    expect(recordingClass(kind)).toBe(cls);
  });

  it("the song's current mix is finished only when the song is selected (or on a release)", () => {
    expect(recordingKindOf({ type: 'song' }, 'self')).toBe('mix');
    expect(recordingClass('mix', { currentMixOfSelectedSong: true })).toBe('finished');
    expect(recordingClass('mix', { currentMixOfSelectedSong: false })).toBe('working');
  });

  it('the kind follows the relation, not the file type, once a track is linked to a song', () => {
    // A master is usually uploaded as a song-type file; a demo too.
    expect(recordingKindOf({ type: 'song' }, 'master')).toBe('master');
    expect(recordingKindOf({ type: 'beat' }, 'demo')).toBe('demo');
    expect(recordingKindOf({ type: 'loop' }, 'beat')).toBe('beat_source');
  });

  it('fails closed (null → no audio capability) for material the table does not classify', () => {
    for (const type of ['song', 'instrumental', 'remix', 'loop', 'topline', null]) {
      expect(recordingKindOf({ type }, null)).toBeNull();
    }
    expect(audioCapabilityFor(String(recordingKindOf({ type: 'remix' }, null)))).toBeNull();
  });
});

describe('songRecordings', () => {
  const t = (id: string, type: string): LinkTrack => ({ id, title: id.toUpperCase(), type });
  const tracks = new Map(
    [t('song', 'song'), t('b1', 'beat'), t('b2', 'beat'), t('inst', 'instrumental'), t('loop', 'loop'), t('top', 'topline'),
      t('mst', 'song'), t('dmo', 'song'), t('alt', 'song'), t('other', 'song')].map((x) => [x.id, x]),
  );
  const linked = mergeLinks('song', {
    mainBeatId: 'b1',
    songBeats: [{ song_track_id: 'song', beat_track_id: 'b2', position: 1 }],
    links: [
      { from_track_id: 'song', to_track_id: 'mst', relation: 'master', position: 0 },
      { from_track_id: 'song', to_track_id: 'dmo', relation: 'demo', position: 0 },
      { from_track_id: 'song', to_track_id: 'inst', relation: 'instrumental', position: 0 },
      { from_track_id: 'song', to_track_id: 'loop', relation: 'loop', position: 0 },
      { from_track_id: 'song', to_track_id: 'top', relation: 'topline', position: 0 },
      { from_track_id: 'song', to_track_id: 'alt', relation: 'version', position: 0 },
      // The song is a version of ANOTHER track: that track is not this song's recording.
      { from_track_id: 'other', to_track_id: 'song', relation: 'version', position: 0 },
    ],
  }, tracks);

  it('classifies the song itself, its versions and everything mergeLinks reads from it', () => {
    const list = songRecordings(song, linked, { versions: [{ id: 'v1', version_label: 'v1 rough' }] });
    expect(list.map((r) => [r.trackId, r.versionId ?? null, r.source, r.kind, r.recordingClass, r.capability, r.current])).toEqual([
      ['song', null, 'self', 'mix', 'working', 'audio.working', true],
      ['song', 'v1', 'track_version', 'mix', 'working', 'audio.working', false],
      ['b1', null, 'beat', 'beat_source', 'working', 'audio.working', false],
      ['b2', null, 'beat', 'beat_source', 'working', 'audio.working', false],
      ['mst', null, 'master', 'master', 'finished', 'audio.finished', false],
      ['inst', null, 'instrumental', 'instrumental', 'finished', 'audio.finished', false],
      ['top', null, 'topline', 'topline', 'working', 'audio.working', false],
      ['loop', null, 'loop', 'loop', 'working', 'audio.working', false],
      ['alt', null, 'version', 'mix', 'working', 'audio.working', false],
      ['dmo', null, 'demo', 'demo', 'working', 'audio.working', false],
    ]);
    expect(list.some((r) => r.trackId === 'other')).toBe(false);
  });

  it("makes the current mix finished once the song is selected, and only the current one", () => {
    const list = songRecordings({ ...song, song_stage: 'selected' }, linked, { versions: [{ id: 'v1', version_label: 'v1' }] });
    expect(list.find((r) => r.source === 'self')?.recordingClass).toBe('finished');
    expect(list.find((r) => r.source === 'track_version')?.recordingClass).toBe('working');
    expect(list.find((r) => r.source === 'version')?.recordingClass).toBe('working');
  });

  it('makes the current mix finished when the song is on a release, whatever its stage', () => {
    const list = songRecordings({ ...song, song_stage: 'archived' }, linked, { onRelease: true });
    expect(list.find((r) => r.source === 'self')?.capability).toBe('audio.finished');
  });

  it('treats a producer song (no stage) as not selected', () => {
    const list = songRecordings({ ...song, song_stage: null }, []);
    expect(list).toEqual([
      expect.objectContaining({ trackId: 'song', kind: 'mix', recordingClass: 'working', current: true }),
    ]);
  });

  it('returns nothing for a track that is not a song', () => {
    expect(songRecordings({ ...song, type: 'beat' }, linked)).toEqual([]);
  });
});
