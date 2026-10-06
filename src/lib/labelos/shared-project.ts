/**
 * What an external project member sees of the project they were admitted to
 * (LABEL-21, 07 §1 "Shared with me"): the project, its songs and recordings,
 * what their role lets them do — and nothing else. Pure; the loader
 * (./shared-project-store) reads the rows, this module shapes them.
 *
 * Built FIELD BY FIELD: no stored reference (`audio_url`, an `r2://` key), no
 * member id, no email, no artist id or link (they see the artist's NAME, not
 * the artist workspace), no stage (A&R's), no cover or price. Audio plays
 * through the per-object route (`/api/org/<org>/audio/<track>`), which
 * re-checks the membership on every request.
 */
import type { Track } from '@/lib/types';
import { externalCan, type ExternalProjectRole } from './capabilities';
import { orgUploadPlayUrl } from './org-upload';
import type { ExternalMembership } from './project-members';

export type SharedTrackRow = {
  id: string;
  title: string | null;
  type: string | null;
  song_stage: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  duration_seconds?: number | null;
  created_by?: string | null;
};

export type SharedRecording = {
  id: string;
  title: string;
  /** `song` for a song or a recording of one; otherwise the track type (beat, loop, topline …). */
  type: string;
  /** A song a version can be added to: a song-type track that has a stage. */
  isSong: boolean;
  bpm: number | null;
  key: string | null;
  durationSeconds: number | null;
  /** The uploader's display name — what D3 credits them with — or null. */
  addedBy: string | null;
  playUrl: string;
  peaksUrl: string;
  /** Set only when the member may download masters; the file's own route audits it. */
  downloadUrl: string | null;
};

export type SharedProjectView = {
  project: { id: string; name: string; orgId: string; orgName: string; artistNames: string[] };
  me: {
    role: ExternalProjectRole;
    allowDownloads: boolean;
    can: { listen: boolean; comment: boolean; uploadVersions: boolean; editMetadata: boolean; download: boolean };
  };
  recordings: SharedRecording[];
  /** Songs a version can be uploaded to, empty unless the role may upload. */
  uploadTargets: { id: string; title: string }[];
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function isSharedSong(t: Pick<SharedTrackRow, 'type' | 'song_stage'>): boolean {
  return t.type === 'song' && t.song_stage !== null && t.song_stage !== undefined;
}

export function toSharedProjectView(input: {
  project: { id: string; name: string | null; orgId: string; orgName: string | null };
  artistNames: readonly string[];
  membership: ExternalMembership;
  /** Tracks in project order. */
  tracks: readonly SharedTrackRow[];
  /** user id → display name, for the credits. */
  names: ReadonlyMap<string, string>;
}): SharedProjectView {
  const { membership: m } = input;
  const opts = { allowDownloads: m.allowDownloads };
  const can = {
    listen: externalCan(m.role, 'listen', opts),
    comment: externalCan(m.role, 'comment', opts),
    uploadVersions: externalCan(m.role, 'upload_versions', opts),
    editMetadata: externalCan(m.role, 'edit_metadata', opts),
    download: externalCan(m.role, 'download_masters', opts),
  };
  const orgId = input.project.orgId;
  const recordings = input.tracks.map((t): SharedRecording => {
    const isSong = isSharedSong(t);
    const base = orgUploadPlayUrl(orgId, t.id);
    return {
      id: t.id,
      title: str(t.title) ?? 'Untitled',
      type: str(t.type) ?? 'track',
      isSong,
      bpm: num(t.bpm),
      key: str(t.key) ? `${str(t.key)}${str(t.scale) ? ` ${str(t.scale)}` : ''}` : null,
      durationSeconds: num(t.duration_seconds),
      addedBy: t.created_by ? (input.names.get(t.created_by) ?? null) : null,
      playUrl: base,
      peaksUrl: `${base}?variant=peaks`,
      downloadUrl: can.download ? `${base}?variant=full&download=1` : null,
    };
  });
  return {
    project: {
      id: input.project.id,
      name: str(input.project.name) ?? 'Untitled project',
      orgId,
      orgName: str(input.project.orgName) ?? 'Organization',
      artistNames: [...new Set(input.artistNames.map((n) => n.trim()).filter(Boolean))],
    },
    me: { role: m.role, allowDownloads: m.allowDownloads, can },
    recordings,
    uploadTargets: can.uploadVersions ? recordings.filter((r) => r.isSong).map((r) => ({ id: r.id, title: r.title })) : [],
  };
}

/**
 * One recording as the persistent PlayerBar plays it: streamed same-origin
 * from the per-object route with the member's session, so no stored
 * reference, preview or peaks URL is set and the player never asks a
 * producer route about it (the same shape as org-workspace#toPlayerTrack).
 */
export function sharedRecordingPlayerTrack(rec: SharedRecording, projectName: string): Track {
  return {
    id: rec.id,
    user_id: '',
    title: rec.title,
    type: rec.type,
    audio_url: rec.playUrl,
    preview_url: null,
    peaks_url: null,
    bands_url: null,
    cover_url: null,
    duration_seconds: rec.durationSeconds,
    bpm: rec.bpm,
    key: rec.key,
    stems_status: 'none',
    created_at: '',
    description: projectName,
  } as unknown as Track;
}
