/**
 * Who may hear one org recording, and which stored file a variant names
 * (LABEL-13, `GET /api/org/[orgId]/audio/[trackId]`). Pure: the route loads
 * the rows, this module decides.
 *
 * D4 (`06` §2.3): `audio.finished` covers finished material, `audio.working`
 * covers working material. Which one a track needs comes from its recording
 * kind (17 R1, `recordingKindOf`) — read from where it sits relative to a
 * song, never from the file:
 *
 *  - linked INTO a song (`mergeLinks` direction 'in'): the relation decides —
 *    a song-type file linked as a song's master is a master;
 *  - a song with no such link: its own current audio, a `mix`, finished
 *    only when the song is `selected` (on a release, once LABEL-16 exists);
 *  - otherwise the track type alone (a beat is a `beat_source`; a loop or
 *    topline is what it says). Anything else has no kind and NO capability
 *    covers it: fail closed.
 *
 * A track can sit in several places at once (a beat on two songs; a song's
 * master that another song also uses as a version). Each context is
 * classified and the caller needs EVERY capability they ask for, so the
 * stricter reading always wins. A working link from a non-song track (a
 * beat's loop) also counts — it can only narrow access. A FINISHED relation
 * from a non-song (a beat's "instrumental") does not count: only a song
 * vouches for finished material, the same rule as the database's
 * `labelos_track_is_finished` (migration 141, lib/labelos/org-read).
 *
 * Stems are working material whatever the track is (§2.3), so a stem
 * variant adds `audio.working` on top.
 */

import type { LinkedItem } from '@/lib/tracks/links';
import { audioCapabilityFor, recordingClass, type RecordingKind } from './capabilities';
import { recordingKindOf } from './recording-kind';

export type AudioCapability = 'audio.finished' | 'audio.working';

/** The four stems the `stems` table holds (`<name>_url`). */
export const ORG_AUDIO_STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
export type OrgAudioStem = (typeof ORG_AUDIO_STEMS)[number];

export type OrgAudioVariant =
  | { kind: 'preview' }
  | { kind: 'full' }
  | { kind: 'wav' }
  | { kind: 'stem'; stem: OrgAudioStem };

/** `preview` | `full` | `wav` | `stem:<vocals|drums|bass|other>`; absent = `full`. Anything else → null. */
export function parseOrgAudioVariant(raw: string | null | undefined): OrgAudioVariant | null {
  if (raw === null || raw === undefined || raw === '' || raw === 'full') return { kind: 'full' };
  if (raw === 'preview' || raw === 'wav') return { kind: raw };
  const m = /^stem:([a-z]+)$/.exec(raw);
  if (m && (ORG_AUDIO_STEMS as readonly string[]).includes(m[1])) return { kind: 'stem', stem: m[1] as OrgAudioStem };
  return null;
}

export interface OrgAudioTrack {
  type: string | null;
  song_stage: string | null;
}

export interface RecordingContext {
  kind: RecordingKind;
  /** The song's own current audio (`self`): finished only for a selected song. */
  current: boolean;
  capability: AudioCapability;
}

/**
 * Every recording kind `track` is, from its one-hop links (`mergeLinks`,
 * read from this track's side). Null when any context has no kind — no
 * capability covers it, so the caller refuses.
 */
export function recordingContexts(track: OrgAudioTrack, linked: readonly LinkedItem[]): RecordingContext[] | null {
  const out: RecordingContext[] = [];
  for (const l of linked) {
    if (l.direction !== 'in') continue;
    const kind = recordingKindOf(track, l.relation);
    const capability = kind ? audioCapabilityFor(kind) : null;
    if (!kind || !capability) return null;
    if (l.track.type === 'song' || recordingClass(kind) === 'working') out.push({ kind, current: false, capability });
  }
  if (out.length > 0) return out;

  if (track.type === 'song') {
    const opts = { currentMixOfSelectedSong: track.song_stage === 'selected' };
    const capability = audioCapabilityFor('mix', opts);
    return capability ? [{ kind: 'mix', current: true, capability }] : null;
  }

  const kind = recordingKindOf(track, null);
  const capability = kind ? audioCapabilityFor(kind) : null;
  return kind && capability ? [{ kind, current: false, capability }] : null;
}

/**
 * The audio capabilities a caller needs for this variant of this track, or
 * null when nothing may grant it (unclassified material).
 */
export function requiredAudioCapabilities(
  track: OrgAudioTrack,
  linked: readonly LinkedItem[],
  variant: OrgAudioVariant,
): Set<AudioCapability> | null {
  const contexts = recordingContexts(track, linked);
  if (!contexts) return null;
  const caps = new Set<AudioCapability>(contexts.map((c) => c.capability));
  if (variant.kind === 'stem') caps.add('audio.working');
  return caps;
}

/** Does a member holding `held` get to hear it? Every required capability, no substitutes. */
export function orgAudioAllowed(held: ReadonlySet<string>, required: ReadonlySet<AudioCapability> | null): boolean {
  if (!required || required.size === 0) return false;
  for (const cap of required) if (!held.has(cap)) return false;
  return true;
}

export interface OrgAudioSourceRow {
  audio_url: string | null;
  wav_url: string | null;
  preview_url: string | null;
}

export type OrgAudioStemRow = Partial<Record<`${OrgAudioStem}_url`, string | null>>;

/**
 * The stored reference a variant streams, or null when the track has none.
 * Read from the row only — the client names a track id and a variant, never
 * a URL or an `r2://` key.
 */
export function orgAudioSource(
  track: OrgAudioSourceRow,
  variant: OrgAudioVariant,
  stems: readonly OrgAudioStemRow[] = [],
): string | null {
  const pick = (v: string | null | undefined) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  switch (variant.kind) {
    case 'preview':
      return pick(track.preview_url);
    case 'full':
      return pick(track.audio_url);
    case 'wav':
      return pick(track.wav_url);
    case 'stem': {
      for (const row of stems) {
        const url = pick(row[`${variant.stem}_url`]);
        if (url) return url;
      }
      return null;
    }
  }
}

/** A download filename from the title and variant; the extension from the stored reference. */
export function orgAudioFilename(title: string | null, variant: OrgAudioVariant, source: string): string {
  const base = (title ?? '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'audio';
  const ext = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(source.split('/').pop() ?? '')?.[1]?.toLowerCase();
  const suffix = variant.kind === 'stem' ? ` - ${variant.stem}` : variant.kind === 'preview' ? ' - preview' : '';
  return `${base}${suffix}${ext ? `.${ext}` : ''}`;
}
