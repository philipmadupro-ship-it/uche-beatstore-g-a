/**
 * "Pick up where you left off" — the Home strip.
 *
 * Merges data Home already holds (player history, projects, playlists) into one
 * short strip: the last thing played, then whatever was touched most recently.
 * Pure, so the ordering rule is tested rather than buried in the page.
 */

export interface ContinueTrack { id: string; title: string }
export interface ContinueCollection {
  id: string;
  name: string;
  status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  track_count?: number;
}

export type ContinueItem<T extends ContinueTrack = ContinueTrack> =
  | { kind: 'track'; id: string; track: T }
  | { kind: 'project'; id: string; project: ContinueCollection }
  | { kind: 'playlist'; id: string; playlist: ContinueCollection };

export const CONTINUE_LIMIT = 6;
const TRACKS_IN_STRIP = 2;

const stamp = (c: ContinueCollection): number => {
  const t = Date.parse(c.updated_at || c.created_at || '');
  return Number.isFinite(t) ? t : 0;
};

export function pickUpWhereLeftOff<T extends ContinueTrack>(input: {
  /** Most recent first (the player's own history order). */
  recentTracks: T[];
  projects: ContinueCollection[];
  playlists: ContinueCollection[];
  limit?: number;
}): Array<ContinueItem<T>> {
  const limit = input.limit ?? CONTINUE_LIMIT;
  const seen = new Set<string>();
  const tracks: ContinueItem<T>[] = [];
  for (const t of input.recentTracks) {
    if (tracks.length >= TRACKS_IN_STRIP) break;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    tracks.push({ kind: 'track', id: t.id, track: t });
  }
  // Archived projects are not "work to resume".
  const collections: Array<{ at: number; item: ContinueItem<T> }> = [
    ...input.projects
      .filter((p) => p.status !== 'archived')
      .map((p) => ({ at: stamp(p), item: { kind: 'project', id: p.id, project: p } as ContinueItem<T> })),
    ...input.playlists.map((p) => ({ at: stamp(p), item: { kind: 'playlist', id: p.id, playlist: p } as ContinueItem<T> })),
  ].sort((a, b) => b.at - a.at);
  return [...tracks, ...collections.map((c) => c.item)].slice(0, limit);
}
