/**
 * Releases and their tracklists (LABEL-16, 05 §2, 17 R1/R2). Pure: the
 * routes under /api/org/[orgId]/releases load rows and write through the
 * service role; this module decides. Its SQL twin is migration 144
 * (`releases_integrity`, `release_items_integrity`, the contiguity
 * constraint trigger, the reorder / remove functions and the "on a release"
 * arm of `labelos_track_is_finished`); releases.test.ts holds the lists equal.
 *
 *  - A release is org-only (org_id NOT NULL, no user_id) and always has a
 *    project (R2): its artwork and documents are that project's files, and
 *    who may read it is who may see that project (`can_see_org_project`).
 *  - A release item is one SONG (a `tracks` row with type 'song', R1) and
 *    the recording that goes out as it: the song itself, or a track the song
 *    links to as `master`, `instrumental` or `version`.
 *  - Positions are 1..n with no gap, after every add, remove and reorder.
 *  - Only terminal / manual facts are stored (`state`, `delivered_at`,
 *    `store_listed`). Gates (LABEL-32) and "released" (LABEL-33) are derived
 *    and not part of this module; nothing here sets those columns.
 */
import type { EventSubject } from './activity';

export const RELEASE_TYPES = ['single', 'ep', 'album', 'mixtape', 'compilation'] as const;
export type ReleaseType = (typeof RELEASE_TYPES)[number];

export const RELEASE_STATES = ['draft', 'delivered', 'cancelled'] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];

/** How the recording on a release item may hang off its song (`track_links.relation`, from the song). */
export const RELEASE_MASTER_RELATIONS = ['master', 'instrumental', 'version'] as const;

/** Project file kinds a release's artwork may be (visual, 143). */
export const RELEASE_ARTWORK_KINDS = ['artwork', 'photo'] as const;

/**
 * States in which a release does NOT put its songs "on a release" (06 §2.3:
 * a song's current mix is finished when it is selected or on a release). A
 * cancelled release is not going out, so it finishes nothing.
 */
export const RELEASE_STATES_OFF_RELEASE = ['cancelled'] as const;

/** A tracklist's ceiling (a box set is well under it); also the reorder body's. */
export const RELEASE_MAX_ITEMS = 200;

/** The context every release event carries (08 §B3): the release, its artist and its project. */
export function releaseEventSubject(r: Pick<ReleaseRow, 'id' | 'contact_id' | 'project_id'>): EventSubject {
  return { type: 'release', id: r.id, artistId: r.contact_id, projectId: r.project_id, releaseId: r.id };
}

export type ReleaseRow = {
  id: string;
  org_id: string;
  project_id: string;
  contact_id: string;
  title: string;
  type: string;
  upc: string | null;
  label_name: string | null;
  c_line: string | null;
  p_line: string | null;
  primary_genre: string | null;
  target_date: string | null;
  release_date: string | null;
  artwork_asset_id: string | null;
  state: string;
  delivered_at: string | null;
  delivered_to: string | null;
  imported_released: boolean;
  store_listed: boolean;
  store_listed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const RELEASE_COLUMNS =
  'id, org_id, project_id, contact_id, title, type, upc, label_name, c_line, p_line, primary_genre, target_date, release_date, artwork_asset_id, state, delivered_at, delivered_to, imported_released, store_listed, store_listed_at, created_by, created_at, updated_at';

export type ReleaseItemRow = {
  id: string;
  release_id: string;
  position: number;
  song_track_id: string;
  master_track_id: string;
  version_title: string | null;
  explicit: boolean;
};

export const RELEASE_ITEM_COLUMNS = 'id, release_id, position, song_track_id, master_track_id, version_title, explicit';

export type ReleaseView = {
  id: string;
  projectId: string;
  contactId: string;
  title: string;
  type: string;
  upc: string | null;
  labelName: string | null;
  cLine: string | null;
  pLine: string | null;
  primaryGenre: string | null;
  targetDate: string | null;
  releaseDate: string | null;
  artworkAssetId: string | null;
  state: string;
  deliveredAt: string | null;
  deliveredTo: string | null;
  importedReleased: boolean;
  storeListed: boolean;
  storeListedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReleaseItemView = {
  id: string;
  position: number;
  songTrackId: string;
  masterTrackId: string;
  versionTitle: string | null;
  explicit: boolean;
};

/** Field by field: a new column is never sent until it is named here. */
export function toReleaseView(r: ReleaseRow): ReleaseView {
  return {
    id: r.id,
    projectId: r.project_id,
    contactId: r.contact_id,
    title: r.title,
    type: r.type,
    upc: r.upc,
    labelName: r.label_name,
    cLine: r.c_line,
    pLine: r.p_line,
    primaryGenre: r.primary_genre,
    targetDate: r.target_date,
    releaseDate: r.release_date,
    artworkAssetId: r.artwork_asset_id,
    state: r.state,
    deliveredAt: r.delivered_at,
    deliveredTo: r.delivered_to,
    importedReleased: r.imported_released,
    storeListed: r.store_listed,
    storeListedAt: r.store_listed_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toReleaseItemView(r: ReleaseItemRow): ReleaseItemView {
  return {
    id: r.id,
    position: r.position,
    songTrackId: r.song_track_id,
    masterTrackId: r.master_track_id,
    versionTitle: r.version_title,
    explicit: r.explicit,
  };
}

export type MasterProblem = 'not_a_song' | 'master_not_linked';

/**
 * Why `masterId` cannot be released as `song`, or null. `links` are
 * track_links rows touching the song (any direction; only song → master
 * with a release relation counts).
 */
export function releaseMasterProblem(
  song: { id: string; type: string | null },
  masterId: string,
  links: ReadonlyArray<{ from_track_id: string; to_track_id: string; relation: string }>,
): MasterProblem | null {
  if (song.type !== 'song') return 'not_a_song';
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (same(masterId, song.id)) return null;
  const relations = RELEASE_MASTER_RELATIONS as readonly string[];
  const linked = links.some((l) => same(l.from_track_id, song.id) && same(l.to_track_id, masterId) && relations.includes(l.relation));
  return linked ? null : 'master_not_linked';
}

export const MASTER_PROBLEM_MESSAGES: Record<MasterProblem, { field: string; error: string }> = {
  not_a_song: { field: 'song_track_id', error: 'song_track_id: only a song goes on a release' },
  master_not_linked: {
    field: 'master_track_id',
    error: 'master_track_id: must be the song itself or linked to it as its master, instrumental or version',
  },
};

export type ArtworkProblem = 'missing' | 'other_project' | 'not_visual';

/** The artwork must be a visual file of the release's own project (and so its org). */
export function releaseArtworkProblem(
  release: { org_id: string; project_id: string },
  asset: { org_id: string | null; project_id: string; kind: string } | null,
): ArtworkProblem | null {
  if (!asset) return 'missing';
  if (asset.org_id !== release.org_id || asset.project_id !== release.project_id) return 'other_project';
  if (!(RELEASE_ARTWORK_KINDS as readonly string[]).includes(asset.kind)) return 'not_visual';
  return null;
}

export const ARTWORK_PROBLEM_MESSAGES: Record<ArtworkProblem, string> = {
  missing: 'artwork_asset_id: no such file',
  other_project: "artwork_asset_id: must be a file of the release's project",
  not_visual: 'artwork_asset_id: must be an artwork or photo file',
};

export function nextItemPosition(items: ReadonlyArray<{ position: number }>): number {
  return items.reduce((max, i) => Math.max(max, i.position), 0) + 1;
}

/** Exactly 1..n, each once. */
export function positionsContiguous(positions: readonly number[]): boolean {
  const sorted = [...positions].sort((a, b) => a - b);
  return sorted.every((p, i) => p === i + 1);
}

type Positioned = { id: string; position: number };

/** The items left after removing `itemId`, renumbered 1..n in their order; null when it is not there. */
export function planItemRemoval(items: readonly Positioned[], itemId: string): Positioned[] | null {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const idx = sorted.findIndex((i) => i.id.toLowerCase() === itemId.toLowerCase());
  if (idx < 0) return null;
  return sorted.filter((_, i) => i !== idx).map((i, n) => ({ id: i.id, position: n + 1 }));
}

export type ReorderPlan = { ok: true; order: Positioned[] } | { ok: false; error: string };

/** The new positions for `order`, which must be a permutation of the release's items. */
export function planReorder(items: readonly Positioned[], order: readonly string[]): ReorderPlan {
  const byId = new Map(items.map((i) => [i.id.toLowerCase(), i.id]));
  const seen = new Set<string>();
  const out: Positioned[] = [];
  for (const raw of order) {
    const key = raw.toLowerCase();
    const id = byId.get(key);
    if (!id || seen.has(key)) break;
    seen.add(key);
    out.push({ id, position: out.length + 1 });
  }
  if (out.length !== order.length || out.length !== items.length) {
    return { ok: false, error: 'order must list every item of the release exactly once' };
  }
  return { ok: true, order: out };
}

/**
 * Is a song on a release, for audio access (06 §2.3)? Rows are the song's
 * release_items with their release's state embedded. The SQL twin is the
 * release arm of `labelos_track_is_finished` (144).
 */
export function countsAsOnRelease(rows: ReadonlyArray<{ releases: { state: string } | null }>): boolean {
  const off = RELEASE_STATES_OFF_RELEASE as readonly string[];
  return rows.some((r) => r.releases !== null && !off.includes(r.releases.state));
}
