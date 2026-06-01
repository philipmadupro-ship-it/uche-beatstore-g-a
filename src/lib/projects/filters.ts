/**
 * Pure filter + sort for the projects list. Extracted (like
 * `lib/store/filters.ts`) so the logic is testable in isolation — UI-embedded
 * logic gets silently reverted, per CLAUDE.md. The page's useMemo delegates here.
 *
 * Adds tag + folder filtering on top of the original status/search/sort, while
 * preserving the exact prior semantics (status defaults to its own value via
 * `(status || 'in_progress')`, string-compare date sorts, localeCompare names).
 */

export interface ProjectTag {
  tag: string;
  category?: string | null;
}

export interface ProjectListItem {
  id: string;
  name: string;
  status?: string | null;
  cover_url?: string | null;
  bpm_target?: number | null;
  key_target?: string | null;
  track_count?: number;
  created_at?: string;
  updated_at?: string;
  store_featured?: boolean;
  is_public?: boolean;
  tags?: ProjectTag[];
  folder_ids?: string[];
}

export type ProjectSortMode = 'recent' | 'updated' | 'name' | 'tracks';
export type ProjectStatusFilter = 'all' | 'in_progress' | 'final' | 'archived';
/** 'all' = every project · 'unfiled' = in no folder · else a folder id. */
export type FolderFilter = 'all' | 'unfiled' | (string & {});

export interface ProjectFilterState {
  search: string;
  status: ProjectStatusFilter;
  folder: FolderFilter;
  /** Selected tag values — AND semantics (a project must carry all of them). */
  tags: Set<string>;
  sort: ProjectSortMode;
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilterState = {
  search: '',
  status: 'all',
  folder: 'all',
  tags: new Set(),
  sort: 'recent',
};

export function filterAndSortProjects(
  projects: ProjectListItem[],
  f: ProjectFilterState,
): ProjectListItem[] {
  const q = f.search.trim().toLowerCase();
  const selectedTags = [...f.tags];

  const matched = projects.filter((p) => {
    // Status — preserve the original default-to-in_progress comparison.
    if (f.status !== 'all' && (p.status || 'in_progress') !== f.status) return false;

    // Folder membership.
    if (f.folder === 'unfiled') {
      if ((p.folder_ids?.length ?? 0) > 0) return false;
    } else if (f.folder !== 'all') {
      if (!(p.folder_ids ?? []).includes(f.folder)) return false;
    }

    // Tags — every selected tag must be present (case-insensitive).
    if (selectedTags.length > 0) {
      const owned = (p.tags ?? []).map((t) => t.tag.toLowerCase());
      if (!selectedTags.every((sel) => owned.includes(sel.toLowerCase()))) return false;
    }

    // Search — name OR any tag value.
    if (q) {
      const inName = p.name.toLowerCase().includes(q);
      const inTags = (p.tags ?? []).some((t) => t.tag.toLowerCase().includes(q));
      if (!inName && !inTags) return false;
    }
    return true;
  });

  const sorted = [...matched];
  switch (f.sort) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'tracks':
      sorted.sort((a, b) => (b.track_count ?? 0) - (a.track_count ?? 0));
      break;
    case 'updated':
      sorted.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
      break;
    case 'recent':
    default:
      sorted.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  }
  return sorted;
}

/** Count of active (non-default) filters — drives the "Clear all" affordance. */
export function activeProjectFilterCount(f: ProjectFilterState): number {
  return [
    f.search.trim() !== '',
    f.status !== 'all',
    f.folder !== 'all',
    f.tags.size > 0,
  ].filter(Boolean).length;
}
