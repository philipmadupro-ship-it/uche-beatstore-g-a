/** Pure filter + sort for the playlists list. Mirrors lib/projects/filters.ts. */

export interface PlaylistTag { tag: string; category?: string | null }
export interface PlaylistListItem {
  id: string; name: string;
  cover_url?: string | null;
  track_count?: number;
  total_duration?: number | null;
  created_at?: string;
  tags?: PlaylistTag[];
  folder_ids?: string[];
  pinned?: boolean;
}

export type PlaylistSortMode = 'recent' | 'name' | 'tracks';
export type PlaylistFolderFilter = 'all' | 'unfiled' | (string & {});

export interface PlaylistFilterState {
  search: string;
  folder: PlaylistFolderFilter;
  tags: Set<string>;
  sort: PlaylistSortMode;
}

export const DEFAULT_PLAYLIST_FILTERS: PlaylistFilterState = {
  search: '', folder: 'all', tags: new Set(), sort: 'recent',
};

export function filterAndSortPlaylists(playlists: PlaylistListItem[], f: PlaylistFilterState): PlaylistListItem[] {
  const q = f.search.trim().toLowerCase();
  const selectedTags = [...f.tags];

  const matched = playlists.filter((p) => {
    if (f.folder === 'unfiled') { if ((p.folder_ids?.length ?? 0) > 0) return false; }
    else if (f.folder !== 'all') { if (!(p.folder_ids ?? []).includes(f.folder)) return false; }
    if (selectedTags.length > 0) {
      const owned = (p.tags ?? []).map((t) => t.tag.toLowerCase());
      if (!selectedTags.every((sel) => owned.includes(sel.toLowerCase()))) return false;
    }
    if (q) {
      const inName = p.name.toLowerCase().includes(q);
      const inTags = (p.tags ?? []).some((t) => t.tag.toLowerCase().includes(q));
      if (!inName && !inTags) return false;
    }
    return true;
  });

  const sorted = [...matched];
  switch (f.sort) {
    case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'tracks': sorted.sort((a, b) => (b.track_count ?? 0) - (a.track_count ?? 0)); break;
    default: sorted.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  }
  return sorted;
}

export function activePlaylistFilterCount(f: PlaylistFilterState): number {
  return [f.search.trim() !== '', f.folder !== 'all', f.tags.size > 0].filter(Boolean).length;
}
