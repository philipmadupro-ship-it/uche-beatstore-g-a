/**
 * Session-scoped stale-while-revalidate cache for dashboard list data.
 *
 * Module-level, so it survives client-side navigation (the SPA never reloads
 * between dashboard pages) but resets on a hard refresh — deliberately NOT
 * persisted: dashboard data is private, and localStorage would need
 * invalidation plumbing. Pages seed their useState from here for an instant
 * paint, then refetch in the background and overwrite; useRealtimeTable keeps
 * long-lived views current.
 */
const cache = new Map<string, unknown>();

export function getCached<T>(key: string): T | null {
  return (cache.get(key) as T | undefined) ?? null;
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
}

/** Drop one key, or everything (e.g. on sign-out). */
export function clearCached(key?: string): void {
  if (key === undefined) cache.clear();
  else cache.delete(key);
}
