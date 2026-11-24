import { createHash } from 'node:crypto';

/**
 * Stem result cache (AUDIO-06) — pure key and invalidation rules, no I/O.
 *
 * No column holds cache state. A split is stored under a key derived from the
 * track id AND a fingerprint of (source ref, model, settings version), so
 *  - "is there a current result?" is "do the four keys for the CURRENT
 *    fingerprint exist",
 *  - a new master (re-upload, version revert) changes the fingerprint and can
 *    never be served the old stems,
 *  - a different track has a different path and never shares an entry,
 *  - writing a key twice is one object,
 *  - it needs no migration, so it works in reduced mode too.
 * The prefix is `stem-cache/`, NOT `stems/`: manual uploads write
 * `stems/<trackId>-<stem>.<ext>` and must never be reachable by pruning.
 */

export const STEM_MODEL = 'htdemucs';
/** Bump to invalidate every cached split (new backend settings, new output format). */
export const STEM_SETTINGS_VERSION = 'v1';
export const CACHE_STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
export type CacheStem = (typeof CACHE_STEMS)[number];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function stemFingerprint(source: string, model = STEM_MODEL, settings = STEM_SETTINGS_VERSION): string {
  return createHash('sha256').update(`${source}|${model}|${settings}`).digest('hex').slice(0, 12);
}

export function stemCacheDir(trackId: string, source: string): string {
  return `stem-cache/${trackId}-${stemFingerprint(source)}`;
}

export function stemCacheKey(trackId: string, source: string, stem: CacheStem): string {
  return `${stemCacheDir(trackId, source)}/${stem}.wav`;
}

/** Listing prefix for one track's cache entries. */
export function stemCachePrefix(trackId: string): string {
  return `stem-cache/${trackId}-`;
}

/**
 * Which of `listedKeys` are SUPERSEDED entries of this track: made from a
 * source the track no longer has. Everything but the current fingerprint's
 * keys (all of them when `currentSource` is null — track deleted).
 *
 * This is the only thing that decides what gets deleted, so it is strict by
 * construction: a key is returned only if it is EXACTLY
 * `stem-cache/<this track's uuid>-<12 hex>/<core stem>.wav`. A masters
 * (`tracks/…`), manual stems (`stems/…`), another track's entry, an old
 * pre-cache stem or a bad listing can never be named.
 */
export function supersededStemKeys(
  listedKeys: string[],
  trackId: string,
  currentSource: string | null | undefined,
): string[] {
  if (!new RegExp(`^${UUID}$`, 'i').test(trackId)) return [];
  const exact = new RegExp(`^stem-cache/${trackId}-[0-9a-f]{12}/(?:${CACHE_STEMS.join('|')})\\.wav$`);
  const keep = new Set(currentSource ? CACHE_STEMS.map((s) => stemCacheKey(trackId, currentSource, s)) : []);
  return [...new Set(listedKeys)].filter((k) => exact.test(k) && !keep.has(k));
}

export type StemCachePruneDeps = {
  list: (prefix: string) => Promise<string[]>;
  remove: (keys: string[]) => Promise<void>;
};

/** Best-effort and never throws; returns how many objects it removed. */
export async function pruneStemCache(
  track: { id: string; source: string | null | undefined },
  deps: StemCachePruneDeps,
): Promise<number> {
  try {
    const stale = supersededStemKeys(await deps.list(stemCachePrefix(track.id)), track.id, track.source);
    if (stale.length === 0) return 0;
    await deps.remove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}

/** Storage side of the cache, injected so the pipeline stays testable. */
export interface StemCacheDeps {
  /** r2:// ref for a key, or null when there is no private storage (local dev: cache off). */
  refFor(key: string): string | null;
  exists(ref: string): Promise<boolean>;
  put(key: string, buffer: Buffer): Promise<string>;
  /** Drop this track's entries that the given source no longer owns. */
  prune(track: { id: string; source: string }): Promise<unknown>;
}

/**
 * The four refs of a COMPLETE current entry, or null (a miss). Any missing
 * object, no storage, or a probe error is a miss: the caller then really
 * splits, which rewrites all four.
 */
export async function lookupStemCache(
  cache: StemCacheDeps,
  trackId: string,
  source: string,
): Promise<Record<CacheStem, string> | null> {
  try {
    const out = {} as Record<CacheStem, string>;
    for (const stem of CACHE_STEMS) {
      const ref = cache.refFor(stemCacheKey(trackId, source, stem));
      if (!ref || !(await cache.exists(ref))) return null;
      out[stem] = ref;
    }
    return out;
  } catch {
    return null;
  }
}
