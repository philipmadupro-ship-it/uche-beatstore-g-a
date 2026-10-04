/**
 * The org Overview's roster table (LABEL-18, 07 §2.1): artists × songs by
 * stage, and each artist's next release. Pure — the loader
 * (overview-store.ts) reads the rows; this decides what the page shows.
 *
 * Scope and the D4 row rule are applied BEFORE this runs: `artists` is the
 * member's own list (scopedOrgQuery) and `visibleSongIds` is what
 * `partitionSongs` let through. So nothing here can name, count or
 * attribute an artist or song the member was not given, and a song the
 * member may not see is only ever a number (`restricted`).
 *
 * A song belongs to an artist the way the workspace says it does
 * (org-workspace-store#artistProjects): through a project that is the
 * artist's Inbox or links them. A song in a project shared by two artists
 * counts for both rows; `totals` counts each song once.
 */
import { stageCounts } from './org-workspace';
import { isSongStage, type SongStage } from './song-stage';

export interface OverviewArtist {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface OverviewRelease {
  id: string;
  contactId: string;
  projectId: string;
  title: string;
  type: string;
  state: string;
  targetDate: string | null;
  createdAt: string;
}

export interface OverviewInput {
  artists: readonly OverviewArtist[];
  /** project id → roster contacts it belongs to (Inbox artist + project_contacts). */
  projectArtists: ReadonlyMap<string, readonly string[]>;
  placements: ReadonlyArray<{ projectId: string; trackId: string }>;
  /** Candidate workspace songs (`isWorkspaceSong`), seen or not. */
  songs: ReadonlyArray<{ id: string; stage: string | null }>;
  /** The candidates the member may see (partitionSongs). */
  visibleSongIds: ReadonlySet<string>;
  releases: readonly OverviewRelease[];
}

/** 07 §2.1's columns, grouping the eight stages. On hold / passed / archived are in the total only. */
export const OVERVIEW_COLUMNS = {
  demos: ['inbox', 'in_review', 'shortlisted'],
  development: ['in_development'],
  selected: ['selected'],
} as const satisfies Record<string, readonly SongStage[]>;
export type OverviewColumns = Record<keyof typeof OVERVIEW_COLUMNS, number>;

export type NextRelease = Pick<OverviewRelease, 'id' | 'title' | 'type' | 'state' | 'targetDate' | 'projectId'>;

export interface OverviewArtistRow extends OverviewArtist {
  /** Songs the member sees for this artist. */
  songs: number;
  /** Songs of this artist the member may not see: a number, never a title. */
  restricted: number;
  stages: ReturnType<typeof stageCounts>;
  columns: OverviewColumns;
  nextRelease: NextRelease | null;
}

export interface RosterSummary {
  artists: OverviewArtistRow[];
  totals: { artists: number; songs: number; restricted: number; stages: ReturnType<typeof stageCounts> };
}

/** The first draft release: earliest target date, undated after dated, then oldest. Delivered and cancelled are not "next". */
export function nextRelease(releases: readonly OverviewRelease[]): NextRelease | null {
  const drafts = releases.filter((r) => r.state === 'draft');
  if (drafts.length === 0) return null;
  const [first] = [...drafts].sort((x, y) => {
    if (!!x.targetDate !== !!y.targetDate) return x.targetDate ? -1 : 1;
    return (x.targetDate ?? '').localeCompare(y.targetDate ?? '') || x.createdAt.localeCompare(y.createdAt);
  });
  return { id: first.id, title: first.title, type: first.type, state: first.state, targetDate: first.targetDate, projectId: first.projectId };
}

function columnsOf(stages: ReturnType<typeof stageCounts>): OverviewColumns {
  const sum = (set: readonly SongStage[]) => stages.filter((s) => set.includes(s.stage)).reduce((n, s) => n + s.count, 0);
  return { demos: sum(OVERVIEW_COLUMNS.demos), development: sum(OVERVIEW_COLUMNS.development), selected: sum(OVERVIEW_COLUMNS.selected) };
}

export function summarizeRoster(input: OverviewInput): RosterSummary {
  // A song without a stage this module knows is not a workspace song: it is in no count, so the headline and the columns agree.
  const stageOf = new Map(input.songs.filter((s) => isSongStage(s.stage)).map((s) => [s.id, s.stage]));
  const rosterIds = new Set(input.artists.map((a) => a.id));

  // artist → the songs placed in their projects
  const songsOf = new Map<string, Set<string>>(input.artists.map((a) => [a.id, new Set()]));
  for (const p of input.placements) {
    if (!stageOf.has(p.trackId)) continue;
    for (const c of input.projectArtists.get(p.projectId) ?? []) if (rosterIds.has(c)) songsOf.get(c)!.add(p.trackId);
  }

  const rows: OverviewArtistRow[] = input.artists.map((a) => {
    const ids = [...songsOf.get(a.id)!];
    const seen = ids.filter((id) => input.visibleSongIds.has(id));
    const stages = stageCounts(seen.map((id) => ({ stage: stageOf.get(id) ?? null })));
    return {
      id: a.id,
      name: a.name,
      avatar_url: a.avatar_url,
      songs: seen.length,
      restricted: ids.length - seen.length,
      stages,
      columns: columnsOf(stages),
      nextRelease: nextRelease(input.releases.filter((r) => r.contactId === a.id)),
    };
  });

  const distinct = new Set<string>();
  const distinctHidden = new Set<string>();
  for (const a of input.artists) {
    for (const id of songsOf.get(a.id)!) (input.visibleSongIds.has(id) ? distinct : distinctHidden).add(id);
  }
  return {
    artists: rows,
    totals: {
      artists: rows.length,
      songs: distinct.size,
      restricted: distinctHidden.size,
      stages: stageCounts([...distinct].map((id) => ({ stage: stageOf.get(id) ?? null }))),
    },
  };
}
