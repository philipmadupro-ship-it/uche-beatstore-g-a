import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
import {
  inboundLinks,
  orgAudioAllowed,
  orgAudioFilename,
  orgAudioSource,
  parseOrgAudioVariant,
  recordingContexts,
  requiredAudioCapabilities,
  type OrgAudioVariant,
  type RawInbound,
} from './org-audio';

const TYPES = new Map<string, string | null>([
  ['song', 'song'], ['song2', 'song'], ['beat', 'beat'], ['mst', 'song'], ['inst', 'instrumental'],
  ['loop', 'loop'], ['top', 'topline'], ['dmo', 'song'], ['alt', 'song'], ['rmx', 'remix'],
]);
const TRACKS = { get: (id: string) => ({ type: TYPES.get(id) ?? null }) };
/** Inbound links of a track, from raw rows (only rows INTO it are passed, as the route reads them). */
const linksOf = (_id: string, raw: Partial<RawInbound> & { links?: { from_track_id: string; to_track_id?: string; relation: string }[] }) =>
  inboundLinks({ songBeats: [], links: [], ...raw }, TYPES);
const link = (from: string, to: string, relation: string) => ({ from_track_id: from, to_track_id: to, relation });

const FULL: OrgAudioVariant = { kind: 'full' };

describe('parseOrgAudioVariant', () => {
  it('reads the four variants, defaulting to full', () => {
    expect(parseOrgAudioVariant(null)).toEqual({ kind: 'full' });
    expect(parseOrgAudioVariant('')).toEqual({ kind: 'full' });
    expect(parseOrgAudioVariant('full')).toEqual({ kind: 'full' });
    expect(parseOrgAudioVariant('preview')).toEqual({ kind: 'preview' });
    expect(parseOrgAudioVariant('wav')).toEqual({ kind: 'wav' });
    expect(parseOrgAudioVariant('stem:vocals')).toEqual({ kind: 'stem', stem: 'vocals' });
    expect(parseOrgAudioVariant('stem:drums')).toEqual({ kind: 'stem', stem: 'drums' });
  });

  it('refuses anything else, including a URL or key smuggled in as a variant', () => {
    for (const raw of ['stem:', 'stem:lead', 'stem:Vocals', 'mp3', 'r2://bucket/key', 'https://x/y.wav', 'stem:vocals_url', 'toString']) {
      expect(parseOrgAudioVariant(raw)).toBeNull();
    }
  });
});

describe('recordingContexts — the kind comes from where the track sits', () => {
  it("a song with no inbound song link is its own current mix: working, finished once selected", () => {
    expect(recordingContexts({ type: 'song', song_stage: 'in_review' }, [])).toEqual([{ kind: 'mix', current: true, capability: 'audio.working' }]);
    expect(recordingContexts({ type: 'song', song_stage: 'selected' }, [])).toEqual([{ kind: 'mix', current: true, capability: 'audio.finished' }]);
  });

  it("a song-type file linked as a song's master is a master (the relation decides, not the type)", () => {
    const linked = linksOf('mst', { links: [link('song', 'mst', 'master')] });
    expect(recordingContexts({ type: 'song', song_stage: null }, linked)).toEqual([{ kind: 'master', current: false, capability: 'audio.finished' }]);
  });

  it.each([
    ['instrumental', 'inst', 'instrumental', 'audio.finished'],
    ['loop', 'loop', 'loop', 'audio.working'],
    ['topline', 'top', 'topline', 'audio.working'],
    ['demo', 'dmo', 'demo', 'audio.working'],
    ['version', 'alt', 'mix', 'audio.working'],
  ])('%s link from a song', (relation, id, kind, capability) => {
    const linked = linksOf(id, { links: [link('song', id, relation)] });
    const contexts = recordingContexts({ type: TRACKS.get(id).type, song_stage: null }, linked);
    expect(contexts?.[0]).toEqual({ kind, current: false, capability });
    // A song-type demo / version is also its own (unselected, so working) mix: same capability.
    expect(new Set(contexts?.map((c) => c.capability))).toEqual(new Set([capability]));
  });

  it('a beat on a song (song_beats) is a beat_source', () => {
    const linked = linksOf('beat', { songBeats: [{ song_track_id: 'song' }] });
    expect(recordingContexts({ type: 'beat', song_stage: null }, linked)).toEqual([{ kind: 'beat_source', current: false, capability: 'audio.working' }]);
  });

  it('several contexts are all kept, so the stricter one is required', () => {
    // A master of one song that a second song also uses as a version.
    const linked = linksOf('mst', { links: [link('song', 'mst', 'master'), link('song2', 'mst', 'version')] });
    const caps = requiredAudioCapabilities({ type: 'song', song_stage: null }, linked, FULL);
    expect([...caps!].sort()).toEqual(['audio.finished', 'audio.working']);
  });

  it('a finished relation from a non-song does not make a track finished; a working one still narrows', () => {
    // A beat's "instrumental": no song vouches for it, so it is read by its type.
    const fromBeat = linksOf('inst', { links: [link('beat', 'inst', 'instrumental')] });
    expect(recordingContexts({ type: 'instrumental', song_stage: null }, fromBeat)).toBeNull();
    // A beat's loop: working, counts.
    const loopOfBeat = linksOf('loop', { links: [link('beat', 'loop', 'loop')] });
    expect(recordingContexts({ type: 'loop', song_stage: null }, loopOfBeat)).toEqual([{ kind: 'loop', current: false, capability: 'audio.working' }]);
  });

  it('a song with only outbound links (its beat, its master) is its own mix', () => {
    expect(recordingContexts({ type: 'song', song_stage: 'selected' }, [])).toEqual([{ kind: 'mix', current: true, capability: 'audio.finished' }]);
  });

  it("a selected song another song uses as a version is BOTH: its own finished mix and a working take", () => {
    const linked = linksOf('alt', { links: [link('song', 'alt', 'version')] });
    const caps = requiredAudioCapabilities({ type: 'song', song_stage: 'selected' }, linked, FULL);
    expect([...caps!].sort()).toEqual(['audio.finished', 'audio.working']);
  });

  it('every inbound row counts — a beat link and a master link from the same song are not deduplicated', () => {
    const linked = linksOf('mst', { songBeats: [{ song_track_id: 'song' }], links: [link('song', 'mst', 'master')] });
    const caps = requiredAudioCapabilities({ type: 'song', song_stage: null }, linked, FULL);
    expect([...caps!].sort()).toEqual(['audio.finished', 'audio.working']);
  });

  it("a song's main beat recorded only in tracks.beat_track_id is still a beat_source", () => {
    const linked = linksOf('beat', { mainBeatOf: ['song'] });
    expect(recordingContexts({ type: 'beat', song_stage: null }, linked)).toEqual([{ kind: 'beat_source', current: false, capability: 'audio.working' }]);
  });

  it('a link from a track outside the org (absent from the type map) is dropped; an unknown relation fails closed', () => {
    expect(linksOf('mst', { links: [link('elsewhere', 'mst', 'master')] })).toEqual([]);
    const odd = linksOf('mst', { links: [link('song', 'mst', 'stem')] });
    expect(recordingContexts({ type: 'song', song_stage: 'selected' }, odd)).toBeNull();
    const proto = linksOf('mst', { links: [link('song', 'mst', '__proto__')] });
    expect(recordingContexts({ type: 'song', song_stage: 'selected' }, proto)).toBeNull();
  });

  it('unlinked material: beat, loop and topline by type; instrumental, remix and unknown types fail closed', () => {
    expect(recordingContexts({ type: 'beat', song_stage: null }, [])?.[0].kind).toBe('beat_source');
    expect(recordingContexts({ type: 'loop', song_stage: null }, [])?.[0].kind).toBe('loop');
    expect(recordingContexts({ type: 'topline', song_stage: null }, [])?.[0].kind).toBe('topline');
    for (const type of ['instrumental', 'remix', 'weird', null]) {
      expect(recordingContexts({ type, song_stage: null }, [])).toBeNull();
      expect(requiredAudioCapabilities({ type, song_stage: null }, [], FULL)).toBeNull();
    }
  });
});

describe('requiredAudioCapabilities + orgAudioAllowed (D4)', () => {
  const marketing = capabilitiesFor('label', 'member', ['marketing']);
  const aAndR = capabilitiesFor('label', 'member', ['a_and_r']);
  const master = linksOf('mst', { links: [link('song', 'mst', 'master')] });
  const topline = linksOf('top', { links: [link('song', 'top', 'topline')] });
  const loop = linksOf('loop', { links: [link('song', 'loop', 'loop')] });

  it('marketing hears a master and not a topline or loop; A&R hears all three', () => {
    const need = (track: string, linked: typeof master, v: OrgAudioVariant = FULL) =>
      requiredAudioCapabilities({ type: TRACKS.get(track).type, song_stage: null }, linked, v);
    expect(orgAudioAllowed(marketing, need('mst', master))).toBe(true);
    expect(orgAudioAllowed(marketing, need('top', topline))).toBe(false);
    expect(orgAudioAllowed(marketing, need('loop', loop))).toBe(false);
    for (const [id, linked] of [['mst', master], ['top', topline], ['loop', loop]] as const) {
      expect(orgAudioAllowed(aAndR, need(id, linked))).toBe(true);
    }
  });

  it("a stem is working material even of a master", () => {
    const caps = requiredAudioCapabilities({ type: 'song', song_stage: null }, master, { kind: 'stem', stem: 'vocals' });
    expect([...caps!].sort()).toEqual(['audio.finished', 'audio.working']);
    expect(orgAudioAllowed(marketing, caps)).toBe(false);
  });

  it('null or empty requirements are never allowed, whatever is held', () => {
    expect(orgAudioAllowed(new Set(['audio.finished', 'audio.working']), null)).toBe(false);
    expect(orgAudioAllowed(new Set(['audio.finished', 'audio.working']), new Set())).toBe(false);
  });

  it('audio.working does not stand in for audio.finished (a revoked finished stays revoked)', () => {
    const workingOnly = new Set(['catalog.read', 'audio.working']);
    expect(orgAudioAllowed(workingOnly, new Set(['audio.finished'] as const))).toBe(false);
  });
});

describe('orgAudioSource', () => {
  const row = { audio_url: 'r2://priv/a.mp3', wav_url: 'r2://priv/a.wav', preview_url: 'r2://priv/a.preview.mp3' };
  it('maps each variant to its column and nothing else', () => {
    expect(orgAudioSource(row, { kind: 'full' })).toBe('r2://priv/a.mp3');
    expect(orgAudioSource(row, { kind: 'wav' })).toBe('r2://priv/a.wav');
    expect(orgAudioSource(row, { kind: 'preview' })).toBe('r2://priv/a.preview.mp3');
    expect(orgAudioSource(row, { kind: 'stem', stem: 'bass' }, [{ bass_url: null }, { bass_url: 'r2://priv/bass.wav' }])).toBe('r2://priv/bass.wav');
  });
  it('null when the track has no such file', () => {
    expect(orgAudioSource({ audio_url: null, wav_url: '', preview_url: '  ' }, { kind: 'full' })).toBeNull();
    expect(orgAudioSource(row, { kind: 'wav' }, [])).toBe('r2://priv/a.wav');
    expect(orgAudioSource({ ...row, wav_url: '' }, { kind: 'wav' })).toBeNull();
    // A WAV uploaded as the main file is the wav variant too.
    expect(orgAudioSource({ ...row, wav_url: null, audio_url: 'r2://priv/b.WAV' }, { kind: 'wav' })).toBe('r2://priv/b.WAV');
    expect(orgAudioSource({ ...row, preview_url: null }, { kind: 'preview' })).toBeNull();
    expect(orgAudioSource(row, { kind: 'stem', stem: 'drums' }, [{ vocals_url: 'r2://priv/v.wav' }])).toBeNull();
  });
});

describe('orgAudioFilename', () => {
  it('title + variant + the stored extension, with unsafe characters dropped', () => {
    expect(orgAudioFilename('Night Shift', { kind: 'wav' }, 'r2://priv/tracks/abc.wav')).toBe('Night Shift.wav');
    expect(orgAudioFilename('A/B: "C"', { kind: 'stem', stem: 'vocals' }, 'r2://priv/s.WAV')).toBe('A B C - vocals.wav');
    expect(orgAudioFilename(null, { kind: 'preview' }, 'r2://priv/p')).toBe('Untitled - preview');
  });
});
