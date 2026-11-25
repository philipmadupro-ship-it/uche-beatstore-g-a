/**
 * The canonical read model of "a file the producer owns" (AUDIO-01).
 *
 * Files live in five places today — a track's master and WAV, the stems job
 * row, uploaded stem files, a project's files — plus an IndexedDB copy. This
 * is ONE typed view over them. It is a READ model: it adds no storage, no
 * table and no route, and every secure path (the owner-gated `/api/audio`
 * proxy, the project-asset download route) stays exactly where it is.
 *
 * Hard rules, enforced by `no-private-refs.test.ts`:
 *  - an Asset never carries an `r2://` / `local://` reference or a signed URL;
 *  - `openUrl` is only a same-origin, owner-gated route;
 *  - views are built field by field, never by spreading a row.
 */

export const ASSET_SOURCES = ['track_audio', 'track_wav', 'track_stem', 'project_file'] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

/** `project` = a DAW session (FL Studio, Ableton, …; AUDIO-02). Derived from the file name, never stored. */
export type AssetKind = 'audio' | 'stem' | 'artwork' | 'document' | 'project' | 'other';

/** Where the bytes live: a public bucket / CDN, the private bucket, or the local filesystem fallback. */
export type AssetLocation = 'public' | 'private' | 'local';

/**
 * Is a copy in this browser's IndexedDB, and is it the current file?
 *  - `none`        nothing saved
 *  - `saved`       saved and current (or saved before fingerprints existed)
 *  - `stale`       saved, but the file changed since — needs re-saving
 *  - `unsupported` this kind of asset cannot be saved offline yet
 */
export type OfflineState = 'none' | 'saved' | 'stale' | 'unsupported';

export interface Asset {
  /** Stable, also the IndexedDB key for non-master copies. */
  id: string;
  source: AssetSource;
  kind: AssetKind;
  ownerType: 'track' | 'project';
  ownerId: string;
  label: string;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  location: AssetLocation;
  /** Short one-way fingerprint of the stored reference. Null when there is no reference. */
  contentKey: string | null;
  /** Can the dashboard play it (audio element / Studio)? */
  playable: boolean;
  /** Same-origin, owner-gated route that serves it; null when it has none. */
  openUrl: string | null;
  /** Filled in by `withOfflineState`; `none` until then. */
  offline: OfflineState;
  /** Only on `project` assets: which DAW wrote it. Name-derived; nothing from inside the file. */
  daw?: { app: string; label: string };
}

/**
 * The IndexedDB key an asset is cached under. A track's master keeps the bare
 * track id (every existing caller — TrackCard, OfflineToggle, the offline page —
 * already keys on it), everything else uses its asset id.
 */
export function offlineCacheId(asset: Pick<Asset, 'id' | 'source' | 'ownerId'>): string {
  return asset.source === 'track_audio' ? asset.ownerId : asset.id;
}
