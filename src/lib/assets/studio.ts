/**
 * Opening a stored asset in the Studio (AUDIO-03): the pure rules.
 *
 * The Studio plays audio from a same-origin, owner-gated route; this module
 * decides WHICH assets it can open, builds the one link every entry point
 * uses, and shapes the single "source" object the Studio consumes. It
 * touches no storage and never outputs a stored reference (`r2://`,
 * `local://`); the only URLs here are the ones AUDIO-01 already allows
 * (`Asset.openUrl`: `/api/audio?src=…` or the project-asset download route).
 */
import type { Asset } from './types';
import { offlineCacheId } from './types';

/** Largest file whose whole-file waveform decode the Studio will attempt (64 MB). */
export const STUDIO_DECODE_MAX_BYTES = 64 * 1024 * 1024;

// Lowercase hex only, on purpose: the ids AUDIO-01 mints come from uuids that are lowercase,
// and an id arrives in a URL, so it is matched EXACTLY before it is used in any request.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PROJECT_FILE = new RegExp(`^project:(${UUID}):file:(${UUID})$`);
const TRACK_FILE = new RegExp(`^track:(${UUID}):(audio|wav)$`);
const TRACK_STEM = new RegExp(`^track:(${UUID}):stem:(vocals|drums|bass|other)$`);

export type StemName = 'vocals' | 'drums' | 'bass' | 'other';

export type ParsedAssetId =
  | { source: 'project_file'; projectId: string; fileId: string }
  | { source: 'track_audio' | 'track_wav'; trackId: string }
  | { source: 'track_stem'; trackId: string; stem: StemName };

/** The exact shapes `assetsOfTrack` / `assetsOfProject` mint, nothing else. Null for any other string. */
export function parseAssetId(id: unknown): ParsedAssetId | null {
  if (typeof id !== 'string' || id.length > 200) return null;
  let m = PROJECT_FILE.exec(id);
  if (m) return { source: 'project_file', projectId: m[1], fileId: m[2] };
  m = TRACK_FILE.exec(id);
  if (m) return { source: m[2] === 'audio' ? 'track_audio' : 'track_wav', trackId: m[1] };
  m = TRACK_STEM.exec(id);
  if (m) return { source: 'track_stem', trackId: m[1], stem: m[2] as StemName };
  return null;
}

export type StudioPlayable = { ok: true } | { ok: false; reason: string };

/** Can the Studio open this asset? Audio and stems yes; a DAW session or a document says why not. */
export function studioPlayable(asset: Pick<Asset, 'kind' | 'playable' | 'openUrl'>): StudioPlayable {
  if ((asset.kind as string) === 'project') return { ok: false, reason: 'Open it in your DAW.' };
  if (asset.kind !== 'audio' && asset.kind !== 'stem') return { ok: false, reason: 'The Studio only opens audio.' };
  if (!asset.playable || !asset.openUrl) return { ok: false, reason: 'This file has no playable copy.' };
  return { ok: true };
}

export type StudioSourceKind = 'project_file' | 'stem' | 'wav';

/** Everything the Studio needs to play an opened asset; it replaces a Library track for this session. */
export interface StudioSource {
  /** The asset id (also the IndexedDB key of a saved copy, see `cacheId`). */
  id: string;
  kind: StudioSourceKind;
  title: string;
  /** Where the track/project it came from, for the header ("Night Drive EP"); null when unknown. */
  from: string | null;
  /** Same-origin owner-gated URL; empty when only a saved copy exists. */
  src: string;
  cacheId: string;
  /** Fingerprint for stale detection; undefined = unknown (a saved copy is then trusted). */
  contentKey: string | null | undefined;
  sizeBytes: number | null;
  /** True when the source could only be built from this device's saved copy (no connection). */
  offlineOnly: boolean;
}

export function studioSourceOf(asset: Asset, opts: { from?: string | null } = {}): StudioSource | null {
  if (!studioPlayable(asset).ok) return null;
  const kind: StudioSourceKind = asset.source === 'project_file' ? 'project_file' : asset.source === 'track_stem' ? 'stem' : 'wav';
  return {
    id: asset.id,
    kind,
    title: asset.label,
    from: opts.from ?? null,
    src: asset.openUrl ?? '',
    cacheId: offlineCacheId(asset),
    contentKey: asset.contentKey,
    sizeBytes: asset.sizeBytes,
    offlineOnly: false,
  };
}

/** `/studio?track=<id>` for a track's own master (the existing deep link), `/studio?asset=<id>` for the rest, null when it cannot open. */
export function studioHref(asset: Asset): string | null {
  if (!studioPlayable(asset).ok) return null;
  if (asset.source === 'track_audio') return `/studio?track=${encodeURIComponent(asset.ownerId)}`;
  return `/studio?asset=${encodeURIComponent(asset.id)}`;
}

/** The same link from an IndexedDB cache key (the offline page): a bare id is a track's master. */
export function studioHrefForCacheId(cacheId: string): string | null {
  const parsed = parseAssetId(cacheId);
  if (!parsed) return new RegExp(`^${UUID}$`).test(cacheId) ? `/studio?track=${cacheId}` : null;
  if (parsed.source === 'track_audio') return `/studio?track=${parsed.trackId}`;
  return `/studio?asset=${encodeURIComponent(cacheId)}`;
}

/** Skip the whole-file waveform decode for a file too big to decode in the page. Unknown size decodes (as tracks always did). */
export function shouldDecodeWaveform(sizeBytes: number | null | undefined): boolean {
  return sizeBytes == null || sizeBytes <= STUDIO_DECODE_MAX_BYTES;
}
