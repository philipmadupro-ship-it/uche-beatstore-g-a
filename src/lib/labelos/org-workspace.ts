/**
 * The org artist workspace and song detail (LABEL-17, 07 §2.2–2.3, 17 R12):
 * the pure rules. The loaders (org-workspace-store.ts) read the rows; this
 * module decides what a member is shown.
 *
 * Two different questions, kept apart:
 *
 *  - May the member see the ROW at all? The database's rule
 *    (`can_read_org_track`, lib/labelos/org-read#orgTrackReadClass): a song
 *    still in development is working material, so marketing (D4: finished
 *    music only) does not get its row. The loaders apply the same rule the
 *    RLS policy does, so the service role never lists more than PostgREST
 *    would.
 *  - May the member HEAR a recording? The audio route's rule
 *    (lib/labelos/org-audio#requiredAudioCapabilities): every context the
 *    track sits in, no substitutes. A recording the member may not hear is
 *    left out of the song view and counted, so the section renders
 *    "restricted" rather than looking empty (07 §3.4).
 *
 * Producer rows are never in here: everything starts from an org row the
 * member reached through requireObjectAccess.
 */

import type { Track } from '@/lib/types';
import { linkLabel } from '@/lib/tracks/links';
import type { Capability } from './capabilities';
import { orgAudioAllowed, type AudioCapability, type OrgAudioVariant } from './org-audio';
import { orgRowAudioAllows, orgTrackReadClass, type InboundLink } from './org-read';
import type { SongRecording } from './recording-kind';
import { SONG_STAGE_LABEL, isSongStage, type SongStage } from './song-stage';

// ── Tabs ────────────────────────────────────────────────────────────────

/**
 * The org workspace's tabs, in order. The producer's Beats / Messages /
 * Notes tabs are pitching and CRM surfaces with no org data behind them yet;
 * Activity is the artist's feed (LABEL-20, `/api/org/[orgId]/activity?artist=`);
 * Credits & Rights and Direction are LABEL-27/26 (Out of Scope here).
 */
export const ORG_WORKSPACE_TABS = ['overview', 'projects', 'songs', 'releases', 'files', 'activity'] as const;
export type OrgWorkspaceTab = (typeof ORG_WORKSPACE_TABS)[number];

export const ORG_WORKSPACE_TAB_LABEL: Record<OrgWorkspaceTab, string> = {
  overview: 'Overview',
  projects: 'Projects',
  songs: 'Songs',
  releases: 'Releases',
  files: 'Files',
  activity: 'Activity',
};

/** `?tab=` → a tab; anything else is Overview. */
export function readOrgWorkspaceTab(raw: string | null | undefined): OrgWorkspaceTab {
  return (ORG_WORKSPACE_TABS as readonly string[]).includes(raw ?? '') ? (raw as OrgWorkspaceTab) : 'overview';
}

// ── Stage ───────────────────────────────────────────────────────────────

export { SONG_STAGE_LABEL };

/** A label for a stored stage; an unknown value reads as itself, never as a stage it is not. */
export function songStageLabel(stage: string | null | undefined): string {
  if (!stage) return '—';
  return isSongStage(stage) ? SONG_STAGE_LABEL[stage] : stage;
}

/** Stage counts for the Overview, in stage order, zero stages left out. */
export function stageCounts(songs: ReadonlyArray<{ stage: string | null }>): Array<{ stage: SongStage; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of songs) if (s.stage) counts.set(s.stage, (counts.get(s.stage) ?? 0) + 1);
  return (Object.keys(SONG_STAGE_LABEL) as SongStage[])
    .filter((st) => (counts.get(st) ?? 0) > 0)
    .map((st) => ({ stage: st, label: SONG_STAGE_LABEL[st], count: counts.get(st) ?? 0 }));
}

// ── Rows a member may see ───────────────────────────────────────────────

/** What the loaders read about one org track to decide row and audio access. */
export interface OrgTrackFacts {
  type: string | null;
  song_stage: string | null;
  on_release: boolean;
  /** Every link INTO the track (song_beats, track_links, a song's beat_track_id), typed by the track it comes from. */
  inbound: InboundLink[];
  /** The audio capabilities the audio route would require for `full`, or null when nothing grants it. */
  requiredAudio: Set<AudioCapability> | null;
}

/** The database's row rule (can_read_org_track), on the facts the loader read. */
export function memberSeesTrackRow(caps: ReadonlySet<string>, facts: Pick<OrgTrackFacts, 'type' | 'song_stage' | 'on_release' | 'inbound'>): boolean {
  return orgRowAudioAllows(caps, orgTrackReadClass(facts, facts.inbound));
}

/** The audio route's rule, on the same facts. */
export function memberHearsTrack(caps: ReadonlySet<string>, facts: Pick<OrgTrackFacts, 'requiredAudio'>): boolean {
  return orgAudioAllowed(caps, facts.requiredAudio);
}

/** A song in the artist's workspace: a `type = 'song'` track with a stage (a song-type master has none). */
export function isWorkspaceSong(track: { type: string | null; song_stage: string | null }): boolean {
  return track.type === 'song' && track.song_stage !== null;
}

/**
 * Split candidate songs into those the member sees and a count of those they
 * do not. The count is what lets the Songs tab say "restricted" instead of
 * looking empty (07 §3.4); it names nothing.
 */
export function partitionSongs<T extends { id: string }>(
  songs: readonly T[],
  facts: ReadonlyMap<string, OrgTrackFacts>,
  caps: ReadonlySet<string>,
): { visible: T[]; hidden: number } {
  const visible: T[] = [];
  let hidden = 0;
  for (const s of songs) {
    const f = facts.get(s.id);
    if (f && memberSeesTrackRow(caps, f)) visible.push(s);
    else hidden += 1;
  }
  return { visible, hidden };
}

// ── Recordings ──────────────────────────────────────────────────────────

export interface RecordingView {
  trackId: string;
  title: string | null;
  /** "Mix" for the song's own audio, else the link's label (Master, Demo, Beat, Loop…). */
  label: string;
  kind: SongRecording['kind'];
  recordingClass: SongRecording['recordingClass'];
  current: boolean;
  durationSeconds: number | null;
}

/**
 * The recordings of a song the member may hear, in songRecordings order,
 * and how many were left out. A recording is shown only when the audio
 * route would stream it (every context's capability, and — for a scoped
 * member — the track in a project they can see), so the A/B list never
 * offers something that answers 403. Track versions are not streamable
 * through the org audio route (it takes a track id), so they are not
 * offered as recordings here.
 */
export function visibleRecordings(
  recordings: readonly SongRecording[],
  facts: ReadonlyMap<string, OrgTrackFacts>,
  caps: ReadonlySet<string>,
  opts: { inScope?: (trackId: string) => boolean; durations?: ReadonlyMap<string, number | null> } = {},
): { recordings: RecordingView[]; restricted: number } {
  const out: RecordingView[] = [];
  const seen = new Set<string>();
  let restricted = 0;
  for (const r of recordings) {
    if (r.versionId) continue;
    if (seen.has(r.trackId)) continue;
    seen.add(r.trackId);
    const f = facts.get(r.trackId);
    const inScope = opts.inScope ? opts.inScope(r.trackId) : true;
    if (!f || !inScope || !memberHearsTrack(caps, f)) {
      restricted += 1;
      continue;
    }
    out.push({
      trackId: r.trackId,
      title: r.title,
      label: r.source === 'self' ? 'Mix' : r.source === 'track_version' ? 'Version' : linkLabel(r.source, 'out'),
      kind: r.kind,
      recordingClass: r.recordingClass,
      current: r.current,
      durationSeconds: opts.durations?.get(r.trackId) ?? null,
    });
  }
  return { recordings: out, restricted };
}

// ── Playing through usePlayer ───────────────────────────────────────────

/** The only URL an org recording is played from (LABEL-13). Never a stored reference. */
export function orgAudioUrl(orgId: string, trackId: string, variant: OrgAudioVariant['kind'] = 'full'): string {
  const v = variant === 'full' ? '' : `?variant=${variant}`;
  return `/api/org/${encodeURIComponent(orgId)}/audio/${encodeURIComponent(trackId)}${v}`;
}

/**
 * A player `Track` for one recording. `audio_url` is the org audio route, so
 * the engine streams it same-origin with the member's session; no peaks or
 * preview URL is set, so the player never asks a producer route about it.
 */
export function toPlayerTrack(orgId: string, rec: RecordingView, song: { title: string | null; cover_url?: string | null; bpm?: number | null; key?: string | null }): Track {
  const name = rec.current ? (song.title ?? 'Untitled') : `${song.title ?? 'Untitled'} · ${rec.label}`;
  return {
    id: rec.trackId,
    user_id: '',
    title: name,
    type: 'song',
    audio_url: orgAudioUrl(orgId, rec.trackId),
    preview_url: null,
    peaks_url: null,
    bands_url: null,
    cover_url: song.cover_url ?? null,
    duration_seconds: rec.durationSeconds,
    bpm: song.bpm ?? null,
    key: song.key ?? null,
    stems_status: 'none',
    created_at: '',
  } as Track;
}

/**
 * A/B: where the new recording starts so the listener hears the same moment.
 * `progress` is a fraction of the element now playing (the player's unit).
 * With both durations known the same SECOND is kept (a master and a mix are
 * rarely the same length to the millisecond); otherwise the same fraction.
 * Clamped into the track, a little short of its end so it does not finish
 * the instant it starts.
 */
export function abSeekFraction(progress: number, fromSeconds: number | null | undefined, toSeconds: number | null | undefined): number {
  const p = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  let f = p;
  if (fromSeconds && toSeconds && fromSeconds > 0 && toSeconds > 0) f = (p * fromSeconds) / toSeconds;
  return Math.min(Math.max(f, 0), 0.995);
}

// ── Releases tab ────────────────────────────────────────────────────────

export interface ReleaseItemTitle {
  position: number;
  songTrackId: string;
  /** Null when the member may not see the song's row: the item is shown as restricted. */
  title: string | null;
  restricted: boolean;
}

/**
 * A release's tracklist with titles joined from the track rows (LABEL-16
 * carry: items carry ids only). A song the member may not see keeps its
 * position and reads "restricted" — never its title.
 */
export function releaseItemTitles(
  items: ReadonlyArray<{ position: number; song_track_id: string }>,
  titles: ReadonlyMap<string, string | null>,
  visible: (trackId: string) => boolean,
): ReleaseItemTitle[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((i) => {
      const ok = visible(i.song_track_id) && titles.has(i.song_track_id);
      return { position: i.position, songTrackId: i.song_track_id, title: ok ? (titles.get(i.song_track_id) ?? 'Untitled') : null, restricted: !ok };
    });
}

// ── Permissions the page needs ──────────────────────────────────────────

export interface OrgWorkspacePermissions {
  /** Upload into this artist (catalog.write). */
  write: boolean;
  /** Hear working material (demos, loops, toplines, beats). */
  working: boolean;
  /** Hear finished material. */
  finished: boolean;
}

export function orgWorkspacePermissions(caps: ReadonlySet<Capability | string>): OrgWorkspacePermissions {
  return {
    write: caps.has('catalog.write'),
    working: caps.has('audio.working'),
    finished: caps.has('audio.finished'),
  };
}
