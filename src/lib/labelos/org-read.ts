/**
 * Who may READ an org catalogue row (LABEL-12): the pure twin of the SQL in
 * migration 141 (`labelos_track_is_finished`, `can_read_org_track`,
 * `can_see_org_project` and the `org_member_read` policies).
 *
 * A row policy cannot run `songRecordings` (recording-kind.ts) per row, so
 * the database uses a NARROWER rule than the routes' per-recording one:
 *
 *  - a track is `finished` only when it is a selected song's own audio, or a
 *    song's `master` / `instrumental`, AND nothing links to it as working
 *    material (a beat, loop, topline, version or demo). Everything else —
 *    including material R1 does not classify — reads as `working`;
 *  - `working` rows need `audio.working`; `finished` rows need
 *    `audio.finished` (or `audio.working`). So marketing (D4) never sees a
 *    demo's row through PostgREST, even where a route might list it.
 *
 * The finer split (a selected song's older versions are working, a mix on a
 * release is finished) stays with the routes (LABEL-13/16). A row the
 * database calls working that a route calls finished is the safe direction.
 */

import type { LinkRelation } from '@/lib/tracks/links';
import type { RecordingClass } from './capabilities';

/** Relations that make the linked-to track finished material (17 R1). */
export const FINISHED_LINK_RELATIONS = ['master', 'instrumental'] as const;

/**
 * Project file kinds anyone with catalog.read may see. Every other kind
 * (references, documents, audio, other) is creative-side material until
 * LABEL-15 adds `sensitivity` and the business kinds.
 */
export const OPEN_ASSET_KINDS = ['artwork', 'lyrics'] as const;

export interface OrgReadTrack {
  type: string | null;
  song_stage: string | null;
}

/** One link INTO the track: `relation` as seen from the track it hangs off. */
export interface InboundLink {
  relation: LinkRelation;
  fromType: string | null;
}

export function orgTrackReadClass(track: OrgReadTrack, inbound: readonly InboundLink[]): RecordingClass {
  const finished = FINISHED_LINK_RELATIONS as readonly string[];
  if (inbound.some((l) => !finished.includes(l.relation))) return 'working';
  if (inbound.some((l) => finished.includes(l.relation) && l.fromType === 'song')) return 'finished';
  if (track.type === 'song' && track.song_stage === 'selected') return 'finished';
  return 'working';
}

export function orgRowAudioAllows(caps: ReadonlySet<string>, cls: RecordingClass): boolean {
  if (caps.has('audio.working')) return true;
  return cls === 'finished' && caps.has('audio.finished');
}

export function orgAssetReadable(caps: ReadonlySet<string>, kind: string): boolean {
  if ((OPEN_ASSET_KINDS as readonly string[]).includes(kind)) return true;
  return caps.has('audio.working');
}

/**
 * The roster contacts that put a project in a member's artist scope: the
 * artist it is the inbox for (`projects.inbox_for_contact_id`) and every
 * contact linked through `project_contacts`. A track is in scope through any
 * project of its org it sits in (`project_tracks`).
 */
export function orgProjectScopeContacts(
  project: { inbox_for_contact_id: string | null },
  linkedContactIds: readonly (string | null)[],
): string[] {
  const ids = [project.inbox_for_contact_id, ...linkedContactIds].filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].sort();
}
