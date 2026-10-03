/**
 * Project files — references, artwork, lyric sheets, documents — as pure
 * rules: what may be uploaded, what kind a file is, where it is stored, and
 * whether a stored reference really is a project file of THIS project.
 *
 * Files live in the private bucket and are only ever streamed by a route that
 * has checked ownership (producer) or portal membership (artist). A stored
 * reference is therefore trusted only in the exact shape `assetObjectKey`
 * produces; anything else a client sends back as a "presigned upload" is
 * refused, so a caller cannot attach another project's object (or a track
 * master) to a project and then download it through the portal.
 */

export const PROJECT_ASSET_KINDS = ['reference', 'artwork', 'lyrics', 'document', 'audio', 'other'] as const;
export type ProjectAssetKind = (typeof PROJECT_ASSET_KINDS)[number];

export const ASSET_KIND_LABEL: Record<ProjectAssetKind, string> = {
  reference: 'Reference',
  artwork: 'Artwork',
  lyrics: 'Lyrics',
  document: 'Document',
  audio: 'Audio',
  other: 'Other',
};

/** Largest project file accepted (a WAV reference fits; a whole session does not). */
export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

/**
 * Largest file sent THROUGH the app server. Vercel caps a request body at
 * ~4.5 MB, so anything larger goes straight to storage on a presigned PUT.
 */
export const MAX_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pages: 'application/vnd.apple.pages',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mid: 'audio/midi',
  midi: 'audio/midi',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/**
 * Extra types an ORGANIZATION project accepts (LABEL-15): press photos,
 * video, split-sheet spreadsheets and DAW sessions. Producer project files
 * keep exactly the list above — `validateAssetFile` only reads this when a
 * caller asks for `{ org: true }`. DAW formats have no registered MIME, so
 * they are stored as an opaque download. `.html` / `.svg` stay refused.
 */
const ORG_EXTRA_EXT_MIME: Record<string, string> = {
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  als: 'application/octet-stream',
  flp: 'application/octet-stream',
  ptx: 'application/octet-stream',
  rpp: 'application/octet-stream',
  cpr: 'application/octet-stream',
};

/** Extension, lowercased, without the dot ('' when there is none). */
export function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export type AssetValidation =
  | { ok: true; extension: string; mime: string }
  | { ok: false; error: 'empty' | 'too-large' | 'unsupported-type' };

/**
 * The type is decided by the EXTENSION, from an allowlist, and the MIME that
 * gets stored is the allowlist's — never the browser's claim. A file with no
 * listed extension is refused: an `.html` or `.svg` served back from our own
 * origin is a script, not a reference.
 */
export function validateAssetFile(file: { name: string; size: number }, opts: { org?: boolean } = {}): AssetValidation {
  if (!file.size || file.size <= 0) return { ok: false, error: 'empty' };
  if (file.size > MAX_ASSET_BYTES) return { ok: false, error: 'too-large' };
  const extension = fileExtension(file.name);
  const mime = EXT_MIME[extension] ?? (opts.org ? ORG_EXTRA_EXT_MIME[extension] : undefined);
  if (!mime) return { ok: false, error: 'unsupported-type' };
  return { ok: true, extension, mime };
}

export function assetValidationMessage(error: Exclude<AssetValidation, { ok: true }>['error'], opts: { org?: boolean } = {}): string {
  if (error === 'empty') return 'That file is empty.';
  if (error === 'too-large') return `Files can be up to ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB.`;
  if (opts.org) return 'That file type is not supported. Use PDF, text, Word, spreadsheets, images, audio, MIDI, video, DAW sessions or ZIP.';
  return 'That file type is not supported. Use PDF, text, Word, images, audio, MIDI, video or ZIP.';
}

/** A sensible default kind for a new upload; the producer can change it. */
export function guessAssetKind(fileName: string): ProjectAssetKind {
  const ext = fileExtension(fileName);
  const name = fileName.toLowerCase();
  if (/lyric/.test(name)) return 'lyrics';
  if (/\b(ref|reference)\b|[_\- ]ref[_\- .]/.test(name)) return 'reference';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) return 'artwork';
  if (['mp3', 'wav', 'aif', 'aiff', 'flac', 'm4a', 'ogg', 'mid', 'midi'].includes(ext)) return 'audio';
  if (['pdf', 'txt', 'md', 'rtf', 'doc', 'docx', 'pages'].includes(ext)) return 'document';
  return 'other';
}

/** Default label: the file name without its extension. */
export function defaultAssetLabel(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').trim();
  const ext = fileExtension(base);
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  return (stem || base || 'Untitled file').slice(0, 200);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a project file is stored, relative to the bucket (or the local data dir). */
export function assetObjectKey(projectId: string, uniqueId: string, extension: string): string {
  if (!UUID.test(projectId)) throw new Error('assetObjectKey: project id must be a uuid');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(uniqueId)) throw new Error('assetObjectKey: bad unique id');
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error('assetObjectKey: bad extension');
  return `project-assets/${projectId}/${uniqueId}.${extension}`;
}

/**
 * The object key inside a stored reference: `r2://<bucket>/<key>` in one of
 * `allowedBuckets`, or `local://<key>`. Null for anything else. The shape
 * check on the key is the caller's (projectAssetKeyOf, and the org twin
 * orgProjectAssetKeyOf in lib/labelos/org-assets).
 */
export function assetRefKey(ref: string, allowedBuckets: readonly string[]): string | null {
  if (ref.startsWith('r2://')) {
    const rest = ref.slice(5);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    if (!allowedBuckets.includes(rest.slice(0, slash))) return null;
    return rest.slice(slash + 1);
  }
  if (ref.startsWith('local://')) return ref.slice(8);
  return null;
}

/** The storage key inside a stored reference, if the reference is a file of this project. */
export function projectAssetKeyOf(ref: string, projectId: string, allowedBuckets: readonly string[]): string | null {
  const key = assetRefKey(ref, allowedBuckets);
  if (key === null) return null;
  const pattern = new RegExp(`^project-assets/${projectId.replace(/[^0-9a-f-]/gi, '')}/[A-Za-z0-9_-]{6,64}\\.[a-z0-9]{1,8}$`);
  return pattern.test(key) ? key : null;
}

/** "3.4 MB" */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** A download file name: the label with the stored extension, stripped of path and control characters. */
export function assetDownloadName(label: string, fileName: string): string {
  const ext = fileExtension(fileName);
  const clean = (label || defaultAssetLabel(fileName)).replace(/[\\/\r\n\t\0"]/g, ' ').trim() || 'file';
  return ext && !clean.toLowerCase().endsWith(`.${ext}`) ? `${clean}.${ext}` : clean;
}

/**
 * When a file became visible in the portal: the later of when it went into
 * the portal and when the project did. Mirrors `availableAt` for tracks.
 */
export function assetAvailableAt(asset: { portal_at: string | null; created_at: string }, projectLinkedAt: string): string {
  const inPortal = asset.portal_at ?? asset.created_at;
  return inPortal > projectLinkedAt ? inPortal : projectLinkedAt;
}
