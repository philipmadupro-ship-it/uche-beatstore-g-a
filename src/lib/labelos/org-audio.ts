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
 *  - linked INTO a song (song_beats, track_links, or a song's
 *    `tracks.beat_track_id`): the relation decides — a song-type file linked
 *    as a song's master is a master;
 *  - a song's own audio is also its current `mix` — finished only when the
 *    song is `selected` or on a release that is not cancelled (LABEL-16;
 *    `on_release`, the twin of migration 144's labelos_track_is_finished) — UNLESS a song
 *    vouches for the file as its master / instrumental, which is what such a
 *    file is (a master is usually uploaded as a song-type file);
 *  - with no song link, the track type alone (a beat is a `beat_source`; a
 *    loop or topline is what it says). Anything else has no kind, and NO
 *    capability covers it: fail closed.
 *
 * A track can sit in several places at once (a beat on two songs; a master
 * another song also uses as a version). EVERY context is kept and the caller
 * needs every capability they call for, so the stricter reading always wins.
 * Links are read from the raw rows, not from `mergeLinks`: that read model
 * keeps one relation per other track for display, and dropping a working
 * link there would widen access here. A working link from a non-song (a
 * beat's loop) also counts — it can only narrow. A FINISHED relation from a
 * non-song (a beat's "instrumental") does not: only a song vouches for
 * finished material, the rule of the database's `labelos_track_is_finished`
 * (migration 141, lib/labelos/org-read).
 *
 * No substitutes: `audio.working` does not stand in for `audio.finished`
 * here, unlike the row rule `orgRowAudioAllows`. The two differ only for a
 * member whose `audio.finished` was revoked, and LABEL-12's note binds the
 * route: never stream a recording to someone who lacks the capability for
 * its kind.
 *
 * Stems are working material whatever the track is (§2.3), so a stem
 * variant adds `audio.working` on top.
 */

import { audioCapabilityFor, recordingClass, type RecordingKind } from './capabilities';
import type { InboundLink } from './org-read';
import { recordingKindOf } from './recording-kind';
import { safeName } from '@/lib/tracks/links';

export type AudioCapability = 'audio.finished' | 'audio.working';

/**
 * The stems the `stems` table has columns for (`<name>_url`, migration 001).
 * Narrower than lib/stems STEM_NAMES, which also names stems the separation
 * service can return but this table cannot store.
 */
export const ORG_AUDIO_STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
export type OrgAudioStem = (typeof ORG_AUDIO_STEMS)[number];

export type OrgAudioVariant =
  | { kind: 'preview' }
  /** The waveform peaks sidecar (LABEL-14: private for org recordings, so it is served here). Same capability as the audio. */
  | { kind: 'peaks' }
  | { kind: 'full' }
  | { kind: 'wav' }
  | { kind: 'stem'; stem: OrgAudioStem };

/** `preview` | `peaks` | `full` | `wav` | `stem:<vocals|drums|bass|other>`; absent = `full`. Anything else → null. */
export function parseOrgAudioVariant(raw: string | null | undefined): OrgAudioVariant | null {
  if (raw === null || raw === undefined || raw === '' || raw === 'full') return { kind: 'full' };
  if (raw === 'preview' || raw === 'wav' || raw === 'peaks') return { kind: raw };
  const m = /^stem:([a-z]+)$/.exec(raw);
  if (m && (ORG_AUDIO_STEMS as readonly string[]).includes(m[1])) return { kind: 'stem', stem: m[1] as OrgAudioStem };
  return null;
}

export interface OrgAudioTrack {
  type: string | null;
  song_stage: string | null;
  /** The song is an item of a release that is not cancelled (lib/labelos/releases#countsAsOnRelease). */
  on_release?: boolean;
}

export interface RecordingContext {
  kind: RecordingKind;
  /** The song's own current audio: finished only for a song that is selected or on a release. */
  current: boolean;
  capability: AudioCapability;
}

/** Raw link rows touching the track, as the route reads them. */
export interface RawInbound {
  /** song_beats rows with beat_track_id = the track. */
  songBeats: ReadonlyArray<{ song_track_id: string }>;
  /** track_links rows with to_track_id = the track. */
  links: ReadonlyArray<{ from_track_id: string; relation: string }>;
  /** Songs whose tracks.beat_track_id is the track (main beat, pre-132 fallback). */
  mainBeatOf?: ReadonlyArray<string>;
}

/**
 * Every link INTO the track, typed by the track it comes from. A row whose
 * other end is not among `types` (another org's, deleted) is dropped.
 * Unknown relations are kept as-is so `recordingContexts` fails closed on them.
 */
export function inboundLinks(raw: RawInbound, types: ReadonlyMap<string, string | null>): InboundLink[] {
  const out: InboundLink[] = [];
  const add = (fromId: string, relation: string) => {
    if (types.has(fromId)) out.push({ relation: relation as InboundLink['relation'], fromType: types.get(fromId) ?? null });
  };
  for (const r of raw.songBeats) add(r.song_track_id, 'beat');
  for (const id of raw.mainBeatOf ?? []) add(id, 'beat');
  for (const r of raw.links) add(r.from_track_id, r.relation);
  return out;
}

const FINISHED_FROM_SONG = new Set(['master', 'instrumental']);

/**
 * Every recording kind `track` is, from its inbound links. Null when any
 * context has no kind — no capability covers it, so the caller refuses.
 */
export function recordingContexts(track: OrgAudioTrack, inbound: readonly InboundLink[]): RecordingContext[] | null {
  const out: RecordingContext[] = [];
  let vouchedFinished = false;
  for (const l of inbound) {
    const kind = recordingKindOf(track, l.relation);
    const capability = kind ? audioCapabilityFor(kind) : null;
    if (!kind || !capability) return null;
    const fromSong = l.fromType === 'song';
    if (fromSong && FINISHED_FROM_SONG.has(l.relation)) vouchedFinished = true;
    if (fromSong || recordingClass(kind) === 'working') out.push({ kind, current: false, capability });
  }

  if (track.type === 'song' && !vouchedFinished) {
    const finishedMix = track.song_stage === 'selected' || track.on_release === true;
    const capability = audioCapabilityFor('mix', { currentMixOfSelectedSong: finishedMix });
    if (!capability) return null;
    out.push({ kind: 'mix', current: true, capability });
  }
  if (out.length > 0) return out;

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
  inbound: readonly InboundLink[],
  variant: OrgAudioVariant,
): Set<AudioCapability> | null {
  const contexts = recordingContexts(track, inbound);
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
  peaks_url?: string | null;
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
    case 'peaks':
      return pick(track.peaks_url);
    case 'full':
      return pick(track.audio_url);
    case 'wav':
      // A WAV master uploaded as the main file has no separate wav_url
      // (the store's download-file route reads it the same way).
      return pick(track.wav_url) ?? (/\.wav(?:[?#]|$)/i.test(track.audio_url ?? '') ? pick(track.audio_url) : null);
    case 'stem': {
      for (const row of stems) {
        const url = pick(row[`${variant.stem}_url`]);
        if (url) return url;
      }
      return null;
    }
  }
}

/**
 * D8 (LABEL-14): an org recording's files — master, preview, peaks, stems —
 * live in the PRIVATE bucket, so that is the only bucket the route streams
 * an org row's reference from. `lib/audio/stream-source` alone also accepts
 * the public bucket (it serves the producer's previews), which is exactly
 * where an org preview must never resolve. Without a private bucket (local
 * development: no R2) the local fallback path is all there is.
 */
export function orgAudioSourceAllowed(source: string, privateBucket: string | null | undefined): boolean {
  const m = /^r2:\/\/([^/]+)\/./.exec(source);
  if (m) return !!privateBucket && m[1] === privateBucket;
  return !privateBucket && source.startsWith('/uploads/') && !source.includes('..');
}

/** A download filename from the title and variant; the extension from the stored reference. */
export function orgAudioFilename(title: string | null, variant: OrgAudioVariant, source: string): string {
  const base = safeName(title ?? '');
  const ext = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(source.split('/').pop() ?? '')?.[1]?.toLowerCase();
  const suffix = variant.kind === 'stem' ? ` - ${variant.stem}` : variant.kind === 'preview' ? ' - preview' : variant.kind === 'peaks' ? ' - peaks' : '';
  return `${base}${suffix}${ext ? `.${ext}` : ''}`;
}
