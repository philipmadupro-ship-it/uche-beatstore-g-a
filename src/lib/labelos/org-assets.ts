/**
 * Org project files (LABEL-15, 17 R2): artwork, photos, video, documents,
 * contracts, split sheets and DAW sessions on an ORGANIZATION project, as
 * rows of `project_assets` (migration 127, widened by 143). No `files` table.
 * Pure — the `/api/org/[orgId]/projects/[id]/assets*` routes load and write;
 * this module decides who may read or write which file, and where it lives.
 *
 * Read rule (06 §2.4, D4), mirrored by `public.labelos_org_asset_allowed`
 * in 143 and held equal by org-assets.test.ts:
 *   every file      — catalog.read (and the project in the member's scope);
 *   visual          — artwork, photo, video, lyrics: nothing more. Marketing
 *                     gets them (finished material + projects);
 *   legal           — contract, split_sheet: nothing more by kind, but these
 *                     two are ALWAYS restricted (CHECK in 143), so they need
 *                     contracts.read;
 *   working         — reference, audio, document, session, other, and any
 *                     kind this module does not know: audio.working, the
 *                     creative side's material (A&R, producers, the artist);
 *   restricted      — any kind: + contracts.read (06 §1 "asset permissions").
 *                     A roster artist can never hold it (NEVER_GRANTABLE).
 *
 * Write rule: the member must be able to read the file (before and after a
 * change), and then needs catalog.write — or, for a restricted file, either
 * catalog.write or rights.write, so legal (rights R W, contracts.read, but
 * catalogue read-only) manages contracts while A&R (no contracts.read)
 * cannot touch them.
 */

import type { Capability } from './capabilities';
import { PROJECT_ASSET_KINDS, assetRefKey, fileExtension, guessAssetKind } from '@/lib/projects/assets';

export const ORG_ASSET_KINDS = [...PROJECT_ASSET_KINDS, 'photo', 'video', 'contract', 'split_sheet', 'session'] as const;
export type OrgAssetKind = (typeof ORG_ASSET_KINDS)[number];

export const ORG_ASSET_KIND_LABEL: Record<OrgAssetKind, string> = {
  reference: 'Reference',
  artwork: 'Artwork',
  lyrics: 'Lyrics',
  document: 'Document',
  audio: 'Audio',
  other: 'Other',
  photo: 'Photo',
  video: 'Video',
  contract: 'Contract',
  split_sheet: 'Split sheet',
  session: 'Session',
};

export const ASSET_SENSITIVITIES = ['normal', 'restricted'] as const;
export type AssetSensitivity = (typeof ASSET_SENSITIVITIES)[number];

/** Kinds anyone with the catalogue may open (still subject to `restricted`). */
export const VISUAL_ASSET_KINDS = ['artwork', 'lyrics', 'photo', 'video'] as const;
/** Rights documents: no working-audio requirement, always restricted. */
export const LEGAL_ASSET_KINDS = ['contract', 'split_sheet'] as const;
/** Kinds whose files are restricted whatever the uploader asks (143 CHECK). */
export const ALWAYS_RESTRICTED_KINDS: readonly OrgAssetKind[] = LEGAL_ASSET_KINDS;

export type AssetReadClass = 'visual' | 'legal' | 'working';

export function isOrgAssetKind(kind: unknown): kind is OrgAssetKind {
  return typeof kind === 'string' && (ORG_ASSET_KINDS as readonly string[]).includes(kind);
}

export function assetReadClass(kind: string): AssetReadClass {
  if ((VISUAL_ASSET_KINDS as readonly string[]).includes(kind)) return 'visual';
  if ((LEGAL_ASSET_KINDS as readonly string[]).includes(kind)) return 'legal';
  return 'working';
}

/** The sensitivity a file of this kind is stored with. */
export function resolveSensitivity(kind: string, requested?: AssetSensitivity | null): AssetSensitivity {
  if ((ALWAYS_RESTRICTED_KINDS as readonly string[]).includes(kind)) return 'restricted';
  return requested ?? 'normal';
}

export type OrgAssetAccessFacts = { kind: string; sensitivity: string };

/** Every capability a member needs to open this file (in addition to scope). */
export function requiredAssetCapabilities(asset: OrgAssetAccessFacts): Capability[] {
  const caps: Capability[] = ['catalog.read'];
  if (assetReadClass(asset.kind) === 'working') caps.push('audio.working');
  // Anything but an explicit 'normal' is treated as restricted: fail closed.
  if (asset.sensitivity !== 'normal') caps.push('contracts.read');
  return caps;
}

export function canReadOrgAsset(caps: ReadonlySet<Capability>, asset: OrgAssetAccessFacts): boolean {
  return requiredAssetCapabilities(asset).every((c) => caps.has(c));
}

export function canWriteOrgAsset(caps: ReadonlySet<Capability>, asset: OrgAssetAccessFacts): boolean {
  if (!canReadOrgAsset(caps, asset)) return false;
  if (asset.sensitivity !== 'normal') return caps.has('catalog.write') || caps.has('rights.write');
  return caps.has('catalog.write');
}

/**
 * What the Files section may offer a member, without a file in hand:
 * `write` — add and change normal files (catalog.write); `restricted` — add
 * and change restricted ones (canWriteOrgAsset's restricted rule);
 * `working` — open working material, so its kinds may be chosen.
 */
export function orgAssetPermissions(caps: ReadonlySet<Capability>): { write: boolean; restricted: boolean; working: boolean } {
  return {
    write: caps.has('catalog.write'),
    restricted: caps.has('contracts.read') && (caps.has('catalog.write') || caps.has('rights.write')),
    working: caps.has('audio.working'),
  };
}

/** The kinds a member may give a file: no legal kinds without the restricted rule, no working kinds without audio.working. */
export function assignableOrgAssetKinds(perms: { restricted: boolean; working: boolean }): OrgAssetKind[] {
  return ORG_ASSET_KINDS.filter((k) => {
    const cls = assetReadClass(k);
    if (cls === 'legal') return perms.restricted;
    if (cls === 'working') return perms.working;
    return true;
  });
}

/**
 * Whether a download request should be audited: once per download, not per
 * Range chunk a player or PDF viewer fetches. A request with no Range, or
 * one starting at byte 0, is a (re)start of the file.
 */
export function isDownloadStart(range: string | null): boolean {
  if (!range) return true;
  return /^bytes=0-/.test(range.trim());
}

const SESSION_EXT = ['als', 'flp', 'ptx', 'rpp', 'cpr'];
const DOCUMENT_EXT = ['pdf', 'doc', 'docx', 'pages', 'rtf', 'txt', 'md', 'csv', 'xlsx'];
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'tif', 'tiff'];

/** A sensible default kind for a new org upload; the member can change it. */
export function guessOrgAssetKind(fileName: string): OrgAssetKind {
  const ext = fileExtension(fileName);
  const name = fileName.toLowerCase();
  // A document's name decides between contract and split sheet. Only a
  // document: "Split Second - cover.png" is artwork, "split vocals.wav" audio.
  if (DOCUMENT_EXT.includes(ext)) {
    if (/split/.test(name)) return 'split_sheet';
    if (/contract|agreement/.test(name)) return 'contract';
  }
  if (SESSION_EXT.includes(ext) || (ext === 'zip' && /session/.test(name))) return 'session';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return /photo|press|shoot|portrait/.test(name) ? 'photo' : 'artwork';
  return guessAssetKind(fileName);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `orgs/<org>/assets/<project>/<id>.<ext>` in the PRIVATE bucket (06 §4). */
export function orgAssetObjectKey(orgId: string, projectId: string, uniqueId: string, extension: string): string {
  if (!UUID.test(orgId)) throw new Error('orgAssetObjectKey: org id must be a uuid');
  if (!UUID.test(projectId)) throw new Error('orgAssetObjectKey: project id must be a uuid');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(uniqueId)) throw new Error('orgAssetObjectKey: bad unique id');
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error('orgAssetObjectKey: bad extension');
  return `orgs/${orgId.toLowerCase()}/assets/${projectId.toLowerCase()}/${uniqueId}.${extension}`;
}

/**
 * The storage key inside a stored reference, if it is a file of THIS org
 * project, in an allowed (private) bucket — the org twin of
 * `projectAssetKeyOf`, whose producer rule is unchanged. A presigned upload
 * is registered only through this, so a member cannot attach another
 * project's or org's object, a master, or a producer file.
 */
export function orgProjectAssetKeyOf(ref: string, orgId: string, projectId: string, allowedBuckets: readonly string[]): string | null {
  if (!UUID.test(orgId) || !UUID.test(projectId)) return null;
  const key = assetRefKey(ref, allowedBuckets);
  if (key === null) return null;
  const pattern = new RegExp(`^orgs/${orgId.toLowerCase()}/assets/${projectId.toLowerCase()}/[A-Za-z0-9_-]{6,64}\\.[a-z0-9]{1,8}$`);
  return pattern.test(key) ? key : null;
}

export const ORG_ASSET_COLUMNS =
  'id, project_id, org_id, kind, sensitivity, label, file_name, url, mime, size_bytes, position, in_portal, portal_at, created_at, created_by';

export interface OrgAssetRow {
  id: string;
  project_id: string;
  org_id: string;
  kind: string;
  sensitivity: string;
  label: string;
  file_name: string;
  url: string;
  mime: string | null;
  size_bytes: number | string | null;
  position: number;
  in_portal: boolean;
  portal_at: string | null;
  created_at: string;
  created_by?: string | null;
}

/** ProjectAssetView's shape plus sensitivity, so the project Files section renders both. */
export interface OrgAssetView {
  id: string;
  project_id: string;
  kind: string;
  sensitivity: AssetSensitivity;
  label: string;
  file_name: string;
  mime: string | null;
  size_bytes: number | null;
  position: number;
  in_portal: boolean;
  portal_at: string | null;
  created_at: string;
  downloadUrl: string;
}

/** Built field by field: no stored reference and no member identity reaches the browser. */
export function toOrgAssetView(row: OrgAssetRow): OrgAssetView {
  return {
    id: row.id,
    project_id: row.project_id,
    kind: row.kind,
    sensitivity: row.sensitivity === 'normal' ? 'normal' : 'restricted',
    label: row.label,
    file_name: row.file_name,
    mime: row.mime,
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    position: row.position,
    in_portal: row.in_portal,
    portal_at: row.portal_at,
    created_at: row.created_at,
    downloadUrl: `/api/org/${row.org_id.toLowerCase()}/projects/${row.project_id}/assets/${row.id}/download`,
  };
}
