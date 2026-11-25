import type { Asset, OfflineState } from './types';

/** The part of an IndexedDB meta row this module reads (see `OfflineMeta`). */
export interface OfflineMetaLike {
  id: string;
  size: number;
  contentKey?: string | null;
}

/** Only audio can be saved offline today; stems/files ride the same store when they are audio. */
export function canSaveOffline(asset: Pick<Asset, 'kind' | 'playable'>): boolean {
  return asset.playable && (asset.kind === 'audio' || asset.kind === 'stem');
}

/**
 * Where an asset stands against what this browser holds.
 *
 * Stale needs BOTH fingerprints: a row saved before fingerprints existed has
 * none, and is read as current rather than accused of being out of date.
 */
export function offlineStateFor(
  asset: Pick<Asset, 'kind' | 'playable' | 'contentKey'>,
  meta: Pick<OfflineMetaLike, 'contentKey'> | null | undefined,
): OfflineState {
  if (!canSaveOffline(asset)) return 'unsupported';
  if (!meta) return 'none';
  if (asset.contentKey && meta.contentKey && asset.contentKey !== meta.contentKey) return 'stale';
  return 'saved';
}

/** Stamp each asset with its offline state from the cached rows (keyed by cache id). */
export function withOfflineState<T extends Asset>(
  assets: readonly T[],
  cacheIdOf: (a: T) => string,
  cached: ReadonlyMap<string, OfflineMetaLike>,
): T[] {
  return assets.map((a) => ({ ...a, offline: offlineStateFor(a, cached.get(cacheIdOf(a))) }));
}

export type CacheEntryKind = 'track' | 'stem' | 'project_file';

/**
 * What an IndexedDB cache key stands for. A bare id is a track's master (the
 * key every older caller uses); `track:<id>:stem:<k>` and `project:<id>:file:<id>`
 * are the ids this model mints.
 */
export function describeCacheId(id: string): { kind: CacheEntryKind; label: string } {
  if (id.startsWith('project:')) return { kind: 'project_file', label: 'Project file' };
  if (/^track:[^:]+:stem:/.test(id)) return { kind: 'stem', label: 'Stem' };
  return { kind: 'track', label: 'Track' };
}
