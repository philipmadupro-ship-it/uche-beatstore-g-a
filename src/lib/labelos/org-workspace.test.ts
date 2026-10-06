import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
import { requiredAudioCapabilities, parseOrgAudioVariant } from './org-audio';
import type { InboundLink } from './org-read';
import { songRecordings } from './recording-kind';
import {
  ORG_WORKSPACE_TABS,
  abSeekFraction,
  isWorkspaceSong,
  memberSeesTrackRow,
  orgAudioUrl,
  orgWorkspacePermissions,
  partitionSongs,
  readOrgWorkspaceTab,
  releaseItemTitles,
  songStageLabel,
  stageCounts,
  toPlayerTrack,
  visibleRecordings,
  type OrgTrackFacts,
} from './org-workspace';

const AR = capabilitiesFor('label', 'member', ['a_and_r']);
const MKT = capabilitiesFor('label', 'member', ['marketing']);
const ARTIST = capabilitiesFor('label', 'artist', []);

function facts(track: { type: string; song_stage: string | null; on_release?: boolean }, inbound: InboundLink[] = []): OrgTrackFacts {
  const t = { ...track, on_release: track.on_release ?? false };
  return { ...t, inbound, requiredAudio: requiredAudioCapabilities(t, inbound, parseOrgAudioVariant('full')!) };
}

describe('tabs', () => {
  it('are the org set, in order, and default to Overview', () => {
    expect(ORG_WORKSPACE_TABS).toEqual(['overview', 'projects', 'songs', 'releases', 'files', 'activity']);
    expect(readOrgWorkspaceTab('activity')).toBe('activity');
    expect(readOrgWorkspaceTab('releases')).toBe('releases');
    expect(readOrgWorkspaceTab('beats')).toBe('overview'); // a producer tab is not an org tab
    expect(readOrgWorkspaceTab(null)).toBe('overview');
  });
});

describe('stage', () => {
  it('labels known stages and leaves unknown values as they are', () => {
    expect(songStageLabel('in_development')).toBe('In development');
    expect(songStageLabel('weird')).toBe('weird');
    expect(songStageLabel(null)).toBe('—');
  });
  it('counts in stage order, zero stages left out', () => {
    expect(stageCounts([{ stage: 'selected' }, { stage: 'inbox' }, { stage: 'inbox' }, { stage: null }])).toEqual([
      { stage: 'inbox', label: 'Inbox', count: 2 },
      { stage: 'selected', label: 'Selected', count: 1 },
    ]);
  });
  it('a workspace song has a stage; a song-type master does not', () => {
    expect(isWorkspaceSong({ type: 'song', song_stage: 'inbox' })).toBe(true);
    expect(isWorkspaceSong({ type: 'song', song_stage: null })).toBe(false);
    expect(isWorkspaceSong({ type: 'beat', song_stage: null })).toBe(false);
  });
});

describe('rows a member sees (D4, the database rule)', () => {
  const inbox = facts({ type: 'song', song_stage: 'inbox' });
  const selected = facts({ type: 'song', song_stage: 'selected' });
  const onRelease = facts({ type: 'song', song_stage: 'in_development', on_release: true });

  it('A&R sees every song; marketing only finished ones', () => {
    for (const f of [inbox, selected, onRelease]) expect(memberSeesTrackRow(AR, f)).toBe(true);
    expect(memberSeesTrackRow(MKT, inbox)).toBe(false);
    expect(memberSeesTrackRow(MKT, selected)).toBe(true);
    expect(memberSeesTrackRow(MKT, onRelease)).toBe(true);
  });

  it('partitions songs and counts the hidden ones without naming them', () => {
    const map = new Map([['a', inbox], ['b', selected]]);
    expect(partitionSongs([{ id: 'a' }, { id: 'b' }, { id: 'c' }], map, MKT)).toEqual({ visible: [{ id: 'b' }], hidden: 2 });
    expect(partitionSongs([{ id: 'a' }, { id: 'b' }], map, AR)).toEqual({ visible: [{ id: 'a' }, { id: 'b' }], hidden: 0 });
  });
});

describe('recordings a member hears', () => {
  const song = { id: 'S', title: 'Midnight', type: 'song', song_stage: 'selected' as const };
  const linked = [
    { relation: 'master' as const, direction: 'out' as const, track: { id: 'M', title: 'Midnight (master)', type: 'song' }, position: 0 },
    { relation: 'demo' as const, direction: 'out' as const, track: { id: 'D', title: 'Midnight (demo)', type: 'song' }, position: 0 },
    { relation: 'loop' as const, direction: 'out' as const, track: { id: 'L', title: 'Pad loop', type: 'loop' }, position: 0 },
    { relation: 'topline' as const, direction: 'out' as const, track: { id: 'T', title: 'Hook', type: 'topline' }, position: 0 },
    { relation: 'version' as const, direction: 'in' as const, track: { id: 'O', title: 'Other song', type: 'song' }, position: 0 },
  ];
  const recs = songRecordings(song, linked);
  const fromSong = (relation: InboundLink['relation']): InboundLink[] => [{ relation, fromType: 'song' }];
  const map = new Map<string, OrgTrackFacts>([
    ['S', facts({ type: 'song', song_stage: 'selected' })],
    ['M', facts({ type: 'song', song_stage: null }, fromSong('master'))],
    ['D', facts({ type: 'song', song_stage: null }, fromSong('demo'))],
    ['L', facts({ type: 'loop', song_stage: null }, fromSong('loop'))],
    ['T', facts({ type: 'topline', song_stage: null }, fromSong('topline'))],
  ]);

  it('A&R hears the mix, master, demo, loop and topline', () => {
    const v = visibleRecordings(recs, map, AR);
    expect(v.recordings.map((r) => [r.trackId, r.label])).toEqual([
      ['S', 'Mix'], ['M', 'Master'], ['D', 'Demo'], ['L', 'Loop'], ['T', 'Topline'],
    ]);
    expect(v.restricted).toBe(0);
  });

  it('marketing never gets loops, toplines or demos — they are counted as restricted (D4, 07 §3.4)', () => {
    const v = visibleRecordings(recs, map, MKT);
    expect(v.recordings.map((r) => r.trackId)).toEqual(['S', 'M']);
    expect(v.restricted).toBe(3);
    expect(JSON.stringify(v.recordings)).not.toMatch(/Pad loop|Hook|demo/);
  });

  it('a roster artist hears everything about their own song (D5)', () => {
    expect(visibleRecordings(recs, map, ARTIST).restricted).toBe(0);
  });

  it('a track the member is scoped out of is restricted even with the capability', () => {
    const v = visibleRecordings(recs, map, AR, { inScope: (id) => id !== 'L' });
    expect(v.recordings.map((r) => r.trackId)).not.toContain('L');
    expect(v.restricted).toBe(1);
  });

  it('a track the loader has no facts for is restricted (fail closed)', () => {
    const partial = new Map([...map].filter(([id]) => id !== 'M'));
    expect(visibleRecordings(recs, partial, AR).recordings.map((r) => r.trackId)).not.toContain('M');
  });

  it('a track that is also a loop elsewhere follows the stricter reading (the audio route rule)', () => {
    const both = new Map(map);
    both.set('M', facts({ type: 'song', song_stage: null }, [{ relation: 'master', fromType: 'song' }, { relation: 'loop', fromType: 'beat' }]));
    expect(visibleRecordings(recs, both, MKT).recordings.map((r) => r.trackId)).toEqual(['S']);
  });

  it('carries durations for A/B', () => {
    const v = visibleRecordings(recs, map, AR, { durations: new Map([['M', 181]]) });
    expect(v.recordings.find((r) => r.trackId === 'M')?.durationSeconds).toBe(181);
    expect(v.recordings.find((r) => r.trackId === 'S')?.durationSeconds).toBeNull();
  });
});

describe('player', () => {
  it('plays only through the org audio route', () => {
    expect(orgAudioUrl('o1', 't1')).toBe('/api/org/o1/audio/t1');
    expect(orgAudioUrl('o1', 't1', 'wav')).toBe('/api/org/o1/audio/t1?variant=wav');
  });

  it('builds a player track with no stored reference, peaks or preview', () => {
    const t = toPlayerTrack('o1', { trackId: 'M', title: 'x', label: 'Master', kind: 'master', recordingClass: 'finished', current: false, durationSeconds: 180 }, { title: 'Midnight' });
    expect(t.audio_url).toBe('/api/org/o1/audio/M');
    expect(t.title).toBe('Midnight · Master');
    expect(t.peaks_url).toBeNull();
    expect(t.preview_url).toBeNull();
    expect(t.duration_seconds).toBe(180);
  });

  it('A/B keeps the same second when both lengths are known, else the same fraction', () => {
    expect(abSeekFraction(0.5, 200, 200)).toBe(0.5);
    expect(abSeekFraction(0.5, 200, 100)).toBe(0.995); // past the end of the shorter take: clamp
    expect(abSeekFraction(0.25, 200, 400)).toBe(0.125);
    expect(abSeekFraction(0.4, null, 300)).toBe(0.4);
    expect(abSeekFraction(Number.NaN, 1, 1)).toBe(0);
    expect(abSeekFraction(-1, null, null)).toBe(0);
  });
});

describe('releases tab titles', () => {
  it('joins titles in position order and keeps a hidden song restricted, untitled', () => {
    const titles = new Map([['a', 'One'], ['b', 'Two']]);
    expect(releaseItemTitles(
      [{ position: 2, song_track_id: 'b' }, { position: 1, song_track_id: 'a' }, { position: 3, song_track_id: 'c' }],
      titles,
      (id) => id !== 'b',
    )).toEqual([
      { position: 1, songTrackId: 'a', title: 'One', restricted: false },
      { position: 2, songTrackId: 'b', title: null, restricted: true },
      { position: 3, songTrackId: 'c', title: null, restricted: true },
    ]);
  });
});

describe('permissions', () => {
  it('reads what the page needs from the capability set', () => {
    expect(orgWorkspacePermissions(AR)).toEqual({ write: true, working: true, finished: true });
    expect(orgWorkspacePermissions(MKT)).toEqual({ write: false, working: false, finished: true });
  });
});
