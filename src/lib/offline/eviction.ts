/**
 * Eviction policy for the EXPLICIT offline-download cache (`antigravity-offline`,
 * see `lib/offline/audio-cache.ts`).
 *
 * This is deliberately NOT the same policy as `lib/audio/preview-cache.ts`'s
 * LRU cache of auto-prefetched clips, and it does not reuse that module's
 * `enforceCap`. Every entry here exists because the producer pressed "Save
 * offline" on a specific track for a specific reason — often to have it ready
 * for a session or a trip that hasn't happened yet. Evicting by recency of
 * *use* (preview-cache's `last_used` LRU) would punish exactly that case: a
 * track saved a month ago and not replayed since would be the first thing
 * dropped, even though "not replayed" is the expected shape of "saved for
 * later," not a sign it's unwanted.
 *
 * So the cap here is generous (2GB — a producer's whole set for a weekend of
 * gigs, not a handful of clips) and eviction only runs when a NEW explicit
 * save would push the total over it. Candidates are ordered oldest-SAVED-first
 * (`cached_at` ascending), not oldest-PLAYED — "when did the producer ask for
 * this" is the only signal available that reflects a deliberate choice rather
 * than incidental listening. Only as many of the oldest entries as needed to
 * fit the incoming track are dropped, never more, and the incoming track
 * itself (not yet in `existing`) is never a candidate — an explicit save is
 * never evicted to make room for itself. If the incoming track alone exceeds
 * the cap even after evicting everything else, it is still allowed through:
 * the producer's current, in-the-moment choice wins over the cap rather than
 * being silently refused.
 */

export const OFFLINE_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

export interface OfflineCacheEntry {
  id: string;
  size: number;
  cached_at: number;
}

/**
 * Returns the ids to remove from the cache to make room for `incomingSize`
 * more bytes, or `[]` when nothing needs to go.
 */
export function planOfflineEviction(
  existing: OfflineCacheEntry[],
  incomingSize: number,
  maxBytes: number = OFFLINE_CACHE_MAX_BYTES,
): string[] {
  const currentTotal = existing.reduce((sum, e) => sum + (e.size || 0), 0);
  const overBy = currentTotal + incomingSize - maxBytes;
  if (overBy <= 0) return [];

  const oldestFirst = [...existing].sort((a, b) => a.cached_at - b.cached_at);
  const evict: string[] = [];
  let freed = 0;
  for (const entry of oldestFirst) {
    if (freed >= overBy) break;
    evict.push(entry.id);
    freed += entry.size || 0;
  }
  return evict;
}
