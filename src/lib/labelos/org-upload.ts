/**
 * Org uploads (LABEL-14): what an audio file uploaded into an organization
 * becomes, and where its bytes may live. Pure — the `/api/org/[orgId]/upload/*`
 * routes and `lib/upload/processing.ts` load and write; this module decides.
 *
 * An org upload is one of two things (W3, 17 R1):
 *   - a new SONG for a roster artist (`type = 'song'`, `song_stage = 'inbox'`),
 *     placed in that artist's Inbox project (Q1, `ensureInboxProject`);
 *   - material LINKED to an existing org song (`demo` / `master` /
 *     `instrumental` / `loop` / `topline` / `version`), written as a
 *     `track_links` row from the song in the same request, because the link
 *     is what classifies it for D4 (LABEL-13: an unlinked upload has no
 *     recording kind and nobody can play it).
 *
 * Bytes (D8 — private until released; R-05):
 *   - the master goes to the private bucket under `orgs/<org>/tracks/`, the
 *     same multipart path producer uploads use, with an org prefix. The prefix
 *     is also what binds an upload session to its org: the session row has no
 *     org column, and the key is minted by the server at init.
 *   - the preview clip and the peaks sidecar go to the PRIVATE bucket under
 *     `orgs/<org>/previews/` and `orgs/<org>/peaks/` — never the public one,
 *     where every producer preview lives. They are served only by the LABEL-13
 *     route, which checks the member against that one recording.
 */

import type { StoredRelation } from '@/lib/tracks/links';

/** The relations an upload can be added to a song "as" (W3). `beat` is not one: a song's beats are song_beats, chosen from the catalogue. */
export const ORG_UPLOAD_RELATIONS = ['demo', 'master', 'instrumental', 'loop', 'topline', 'version'] as const satisfies readonly StoredRelation[];
export type OrgUploadRelation = (typeof ORG_UPLOAD_RELATIONS)[number];

export type OrgUploadIntent =
  | { kind: 'song'; contactId: string }
  | { kind: 'link'; songId: string; relation: OrgUploadRelation };

const org = (orgId: string) => orgId.toLowerCase();

/** Where an org's masters go in the private bucket. */
export function orgUploadKeyPrefix(orgId: string): string {
  return `orgs/${org(orgId)}/tracks`;
}

/**
 * Is this upload-session key one minted for `orgId`? R2 keys are
 * `orgs/<org>/tracks/<id>.<ext>`; the local fallback's are
 * `local:orgs/<org>/tracks/<session>`. The org routes refuse a session whose
 * key is not their org's, so a session id alone never moves a file between
 * orgs, or from a producer upload into an org.
 */
export function isOrgUploadKey(key: string, orgId: string): boolean {
  const rest = key.startsWith('local:') ? key.slice(6) : key;
  const prefix = `${orgUploadKeyPrefix(orgId)}/`;
  if (!rest.startsWith(prefix)) return false;
  const tail = rest.slice(prefix.length);
  return tail.length > 0 && !tail.includes('/') && !tail.includes('..');
}

/** Any org's upload key — what a producer upload route refuses to finish. */
export function isAnyOrgUploadKey(key: string): boolean {
  return /^(?:local:)?orgs\//.test(key);
}

/**
 * An org recording's master (`r2://<bucket>/orgs/<org>/tracks/…`). The
 * producer pipeline's public derivatives — `uploadPublicPreview`, the peaks
 * and bands sidecars, the preview backfill — refuse to derive anything from
 * one, so no producer route, cron or button can publish an org recording
 * that the org path itself keeps private (R-05).
 */
export function isOrgMasterRef(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && /^r2:\/\/[^/]+\/orgs\/[0-9a-f-]{36}\/tracks\//i.test(ref);
}

export type OrgMediaKind = 'previews' | 'peaks';

/** `orgs/<org>/<kind>/<id>.<ext>` — the private home of a derived file. */
export function orgMediaKey(orgId: string, kind: OrgMediaKind, id: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, '') || 'x';
  return `orgs/${org(orgId)}/${kind}/${safeId}.${safeExt}`;
}

/**
 * `r2://bucket/key` → parts. The same shape as lib/storage/upload's
 * `parseR2ObjectRef`, repeated here so this module stays importable by
 * client components (that one brings the S3 client and `fs` with it).
 */
function parseRef(value: string): { bucket: string; key: string } | null {
  const m = /^r2:\/\/([^/]+)\/(.+)$/.exec(value);
  return m ? { bucket: m[1], key: m[2] } : null;
}

/**
 * True only for an `r2://` reference into the PRIVATE bucket under this
 * org's `<kind>/` prefix. What the processing job checks before it writes a
 * preview or peaks reference onto an org track, so a misconfigured bucket can
 * never turn into a public org preview (R-05).
 */
export function isPrivateOrgMediaRef(
  ref: string,
  opts: { orgId: string; privateBucket: string | null | undefined; kind: OrgMediaKind },
): boolean {
  const parsed = parseRef(ref);
  if (!parsed || !opts.privateBucket || parsed.bucket !== opts.privateBucket) return false;
  const prefix = `orgs/${org(opts.orgId)}/${opts.kind}/`;
  return parsed.key.startsWith(prefix) && !parsed.key.includes('..');
}

/**
 * The type and stage of the track an upload creates. A linked file's type
 * fits its relation: a master, demo or alternate version is a recording of
 * the song (a song-type file — the way `recordingKindOf` expects a master),
 * an instrumental / loop / topline is that type. Only a new song gets a
 * stage; linked material is not an A&R item of its own.
 */
export function orgUploadTrackFields(intent: OrgUploadIntent): { type: string; song_stage: 'inbox' | null } {
  if (intent.kind === 'song') return { type: 'song', song_stage: 'inbox' };
  switch (intent.relation) {
    case 'instrumental':
    case 'loop':
    case 'topline':
      return { type: intent.relation, song_stage: null };
    default:
      return { type: 'song', song_stage: null };
  }
}

/** How an org player names a recording: always the per-object LABEL-13 route. */
export function orgUploadPlayUrl(orgId: string, trackId: string, variant?: 'preview' | 'peaks'): string {
  const base = `/api/org/${org(orgId)}/audio/${encodeURIComponent(trackId)}`;
  return variant ? `${base}?variant=${variant}` : base;
}

export interface OrgUploadTrackRow {
  id: string;
  org_id: string | null;
  title: string | null;
  type: string | null;
  song_stage: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  duration_seconds?: number | null;
  [column: string]: unknown;
}

export interface OrgUploadTrackView {
  id: string;
  orgId: string;
  title: string | null;
  type: string | null;
  songStage: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  durationSeconds: number | null;
  projectIds: string[];
  linkedTo: { songId: string; relation: OrgUploadRelation } | null;
  playUrl: string;
}

/**
 * The created track as the uploads tray sees it — built field by field, so
 * no stored reference (`audio_url`, `preview_url`, an `r2://` key) and no
 * member identity ever reaches the browser. It plays through `playUrl`.
 */
export function orgUploadTrackView(
  row: OrgUploadTrackRow,
  placement: { projectIds: string[]; linkedTo: OrgUploadTrackView['linkedTo'] },
): OrgUploadTrackView {
  const orgId = String(row.org_id ?? '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: row.id,
    orgId,
    title: str(row.title),
    type: str(row.type),
    songStage: str(row.song_stage),
    bpm: num(row.bpm),
    key: str(row.key),
    scale: str(row.scale),
    durationSeconds: num(row.duration_seconds),
    projectIds: [...placement.projectIds],
    linkedTo: placement.linkedTo,
    playUrl: orgUploadPlayUrl(orgId, row.id),
  };
}
