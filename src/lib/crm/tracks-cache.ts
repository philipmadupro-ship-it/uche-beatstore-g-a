import type { Track } from '@/lib/types';

// Module-level cache so re-opening the history drawer, or showing the "Sent to"
// list on successive contacts, doesn't refetch the whole /api/tracks list every
// time. 60s TTL: long enough to skip the duplicate cost when someone clicks
// through four contacts in five seconds, short enough that fresh uploads land
// in the lookup within a minute.
let cache: { at: number; promise: Promise<Track[]> } | null = null;
const TTL_MS = 60_000;

export function loadTracksCached(): Promise<Track[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetch('/api/tracks')
    .then((r) => (r.ok ? r.json() : []))
    .then((data) => (Array.isArray(data) ? data : data.tracks || []))
    .catch(() => []) as Promise<Track[]>;
  cache = { at: Date.now(), promise };
  return promise;
}
