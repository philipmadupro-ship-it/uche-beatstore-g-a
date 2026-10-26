/**
 * The recording-kind adapter (17 R1): `main`'s song model, read as Label OS
 * recordings.
 *
 * A song is a `tracks` row with `type = 'song'`. Its recordings are the song
 * track itself (current audio), its `track_versions`, and whatever
 * `mergeLinks` (lib/tracks/links.ts) reads from it: beats through
 * `song_beats`, and instrumental / loop / topline / version / master / demo
 * through `track_links`. There is no `song_recordings` table; this module
 * maps each of those onto a LABEL-02 recording kind so `recordingClass` /
 * `audioCapabilityFor` (capabilities.ts, unchanged) can decide who hears it.
 *
 * Pure. Material the R1 table does not classify maps to null, which no audio
 * capability covers: it fails closed rather than guessing a class.
 */

import type { LinkedItem, LinkRelation } from '@/lib/tracks/links';
import { audioCapabilityFor, recordingClass, type RecordingClass, type RecordingKind } from './capabilities';
import type { SongStage } from './song-stage';

/**
 * Where a track sits relative to the song:
 *   'self'          — the song track's own current audio;
 *   'track_version' — an older `track_versions` snapshot of the song;
 *   a LinkRelation  — linked FROM the song (the song's beat, master, …);
 *   null            — not linked to any song.
 */
export type SongSide = 'self' | 'track_version' | LinkRelation;

const BY_RELATION: Readonly<Record<SongSide, RecordingKind>> = {
  self: 'mix',
  track_version: 'mix',
  version: 'mix',
  beat: 'beat_source',
  loop: 'loop',
  topline: 'topline',
  instrumental: 'instrumental',
  master: 'master',
  demo: 'demo',
};

/**
 * Unlinked tracks whose TYPE is already a recording kind. R1 lists only the
 * beat; LABEL-13 adds loop and topline (a standalone loop in an artist's
 * inbox is a loop), both working material, so the addition can only reach
 * people who already hear every linked loop. An unlinked instrumental or
 * remix stays null: calling it finished would hand it to the business side
 * with no song vouching for it.
 */
const BY_UNLINKED_TYPE: Readonly<Record<string, RecordingKind>> = {
  beat: 'beat_source',
  loop: 'loop',
  topline: 'topline',
};

/**
 * The 17 R1 mapping table. Once a track is linked to a song, the relation
 * decides (a master is usually uploaded as a song-type file). Unlinked, a
 * `beat` is a `beat_source` and a `loop` / `topline` is itself; anything
 * else is null.
 */
export function recordingKindOf(track: { type: string | null }, relationFromSong: SongSide | null): RecordingKind | null {
  if (relationFromSong) return BY_RELATION[relationFromSong] ?? null;
  return Object.hasOwn(BY_UNLINKED_TYPE, track.type ?? '') ? BY_UNLINKED_TYPE[track.type as string] : null;
}

export interface SongRecording {
  trackId: string;
  /** Set for a `track_versions` snapshot (trackId is then the song's). */
  versionId?: string;
  title: string | null;
  source: SongSide;
  kind: RecordingKind;
  /** The song's own current audio — the only recording that can be the finished mix. */
  current: boolean;
  recordingClass: RecordingClass;
  capability: 'audio.finished' | 'audio.working';
}

export interface SongForRecordings {
  id: string;
  title: string | null;
  type: string | null;
  song_stage?: SongStage | null;
}

/**
 * Every recording of `song`, classified: the song's current audio first,
 * then its older versions, then the linked material in `mergeLinks` order.
 * Only links read FROM the song count ('out'); a track the song is itself a
 * version / master / … of is another song's material, not this one's.
 *
 * The current mix is finished when the song is `selected` or sits on a
 * release (`onRelease`, known once releases exist — LABEL-16); every other
 * mix is an earlier take and working.
 */
export function songRecordings(
  song: SongForRecordings,
  linked: readonly LinkedItem[],
  opts: { versions?: ReadonlyArray<{ id: string; version_label: string | null }>; onRelease?: boolean } = {},
): SongRecording[] {
  if (song.type !== 'song') return [];
  const finishedMix = song.song_stage === 'selected' || opts.onRelease === true;
  const out: SongRecording[] = [];
  const push = (r: Omit<SongRecording, 'kind' | 'recordingClass' | 'capability'>, type: string | null) => {
    const kind = recordingKindOf({ type }, r.source);
    if (!kind) return;
    const classOpts = { currentMixOfSelectedSong: r.current && finishedMix };
    const cls = recordingClass(kind, classOpts);
    const capability = audioCapabilityFor(kind, classOpts);
    if (!cls || !capability) return;
    out.push({ ...r, kind, recordingClass: cls, capability });
  };
  push({ trackId: song.id, title: song.title, source: 'self', current: true }, song.type);
  for (const v of opts.versions ?? []) {
    push({ trackId: song.id, versionId: v.id, title: v.version_label, source: 'track_version', current: false }, song.type);
  }
  for (const l of linked) {
    if (l.direction !== 'out') continue;
    push({ trackId: l.track.id, title: l.track.title, source: l.relation, current: false }, l.track.type);
  }
  return out;
}
