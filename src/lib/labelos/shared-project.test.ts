import { describe, expect, it } from 'vitest';
import { EXTERNAL_PROJECT_ROLES } from './capabilities';
import { isSharedSong, sharedRecordingPlayerTrack, toSharedProjectView, type SharedTrackRow } from './shared-project';

const ORG = '10000000-0000-4000-8000-000000000001';
const tracks: (SharedTrackRow & Record<string, unknown>)[] = [
  {
    id: 't1', title: 'Midnight', type: 'song', song_stage: 'selected', bpm: 140.4, key: 'F', scale: 'minor', duration_seconds: 200, created_by: 'u1',
    audio_url: 'r2://priv/secret.wav', wav_url: 'r2://priv/secret.wav', preview_url: 'r2://priv/p.mp3', cover_url: 'https://cdn/x.png', org_id: ORG,
  },
  { id: 't2', title: '  ', type: 'loop', song_stage: null, duration_seconds: null, created_by: null },
  { id: 't3', title: 'Master', type: 'song', song_stage: null, created_by: 'gone' },
];
const build = (role: (typeof EXTERNAL_PROJECT_ROLES)[number], allowDownloads = false) =>
  toSharedProjectView({
    project: { id: 'p1', name: 'Uche × Producer X', orgId: ORG, orgName: 'Night Shift' },
    artistNames: [' Nova ', 'Nova', ''],
    membership: { projectId: 'p1', role, allowDownloads },
    tracks,
    names: new Map([['u1', 'Dana']]),
  });

describe('toSharedProjectView', () => {
  it('is built field by field: no stored reference, stage, owner or artist id can reach the page', () => {
    const text = JSON.stringify(build('editor'));
    for (const leak of ['r2://', 'secret', 'cdn/x.png', 'selected', 'song_stage', 'audio_url', 'wav_url', 'preview_url', 'u1', 'gone', 'org_id']) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it('names the recordings, plays them through the per-object route, and credits the uploader by name only', () => {
    const v = build('viewer');
    expect(v.recordings.map((r) => [r.id, r.title, r.type, r.addedBy])).toEqual([
      ['t1', 'Midnight', 'song', 'Dana'],
      ['t2', 'Untitled', 'loop', null],
      ['t3', 'Master', 'song', null], // an unknown uploader is not guessed
    ]);
    expect(v.recordings[0]).toMatchObject({ playUrl: `/api/org/${ORG}/audio/t1`, peaksUrl: `/api/org/${ORG}/audio/t1?variant=peaks`, key: 'F minor', bpm: 140.4 });
  });

  it('de-duplicates and trims the artist names', () => {
    expect(build('viewer').project.artistNames).toEqual(['Nova']);
  });

  it('only a song with a stage is an upload target, and only for a role that uploads', () => {
    expect(isSharedSong({ type: 'song', song_stage: 'inbox' })).toBe(true);
    expect(isSharedSong({ type: 'song', song_stage: null })).toBe(false);
    expect(isSharedSong({ type: 'loop', song_stage: 'inbox' })).toBe(false);
    expect(build('viewer').uploadTargets).toEqual([]);
    expect(build('commenter').uploadTargets).toEqual([]);
    expect(build('contributor').uploadTargets).toEqual([{ id: 't1', title: 'Midnight' }]);
    expect(build('editor').uploadTargets).toEqual([{ id: 't1', title: 'Midnight' }]);
  });

  it('the download link follows §2.6', () => {
    expect(build('viewer').recordings[0].downloadUrl).toBeNull();
    expect(build('viewer', true).recordings[0].downloadUrl).toBe(`/api/org/${ORG}/audio/t1?variant=full&download=1`);
    expect(build('commenter').recordings[0].downloadUrl).toBeNull();
    expect(build('contributor').recordings[0].downloadUrl).not.toBeNull();
    expect(build('editor').recordings[0].downloadUrl).not.toBeNull();
  });

  it('the player track names no stored reference', () => {
    const rec = build('viewer').recordings[0];
    const t = sharedRecordingPlayerTrack(rec, 'Uche × Producer X');
    expect(t).toMatchObject({ id: 't1', audio_url: rec.playUrl, preview_url: null, peaks_url: null, bands_url: null, cover_url: null });
  });
});
