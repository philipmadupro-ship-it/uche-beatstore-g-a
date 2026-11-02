/**
 * The artistic direction workspace (LABEL-68, doc 23): ONE place that READS what the earlier tasks stored — an artist's
 * direction and references (LABEL-26), the A&R reviews (LABEL-25), song stages (LABEL-24) and releases with their
 * approvals (LABEL-30 / 32) — and shows where the creative work stands. It owns no data: no table, no column, nothing
 * here is written back. Every number on it is derived on read from the sources through the same scope and D4 rules the
 * source screens use.
 *
 * Pure. `creative-workspace-store.ts` loads the facts for ONE member; this module only shapes them.
 *
 *  - A direction is shown as a brief (sound + next move + keywords), never the whole document: the artist's tab is where
 *    it is edited, and a card links there.
 *  - Songs are tallied by stage only over the songs the member may read (D4); the rest are counted as `restricted` by the
 *    store (and only for a viewer allowed to see such counts), never named.
 *  - The creative gate is the optional sixth release gate. Its state is `creativeGateState` from the readiness module —
 *    the same function the release page uses — so the workspace and the release cannot disagree.
 */
import { normalizeDirection, DIRECTION_FIELDS, type ArtistDirection } from './direction';
import type { GateStatus } from './release-readiness';
import { SONG_STAGES, type SongStage } from './song-stage';

export const BRIEF_MAX = 160;

/** Shorten on a word boundary where there is one; never past `max`. */
export function clip(text: string, max = BRIEF_MAX): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type DirectionBrief = {
  sound: string | null;
  next: string | null;
  keywords: string[];
  /** How many of the six fields have words, so a card can say "3 of 6". */
  filled: number;
  total: number;
};

/** A stored direction (any shape) as a brief. Total: null, a string or an array reads as an empty one. */
export function directionBrief(raw: unknown): DirectionBrief {
  const d: ArtistDirection = normalizeDirection(raw);
  return {
    sound: d.sound ? clip(d.sound) : null,
    next: d.next ? clip(d.next) : null,
    keywords: (d.keywords ?? []).slice(0, 6),
    filled: DIRECTION_FIELDS.filter((f) => !!d[f]).length,
    total: DIRECTION_FIELDS.length,
  };
}

export type StageTally = { total: number; byStage: Partial<Record<SongStage, number>> };

/** Songs per stage, in the order of the pipeline; a stage nobody is in is absent. Unknown stages are not counted. */
export function tallyStages(stages: ReadonlyArray<string | null | undefined>): StageTally {
  const byStage: Partial<Record<SongStage, number>> = {};
  let total = 0;
  for (const s of stages) {
    if (!s || !(SONG_STAGES as readonly string[]).includes(s)) continue;
    byStage[s as SongStage] = (byStage[s as SongStage] ?? 0) + 1;
    total += 1;
  }
  return { total, byStage };
}

/** The stages where a song is waiting for the creative team's judgement. */
export const REVIEW_STAGES: readonly SongStage[] = ['inbox', 'in_review'];

export const waitingForReview = (t: StageTally): number => REVIEW_STAGES.reduce((n, s) => n + (t.byStage[s] ?? 0), 0);

export type ArtistCardInput = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** The stored `artist_direction.direction` or null. */
  direction: unknown;
  /** References the member may read (internal ones already left out for an artist; D4 applied). */
  references: number;
  /** Songs the member may read, by stage. */
  stages: StageTally;
  /**
   * Songs in the review stages that no one has reviewed yet. Judged over the reviews the member may read: a member
   * without `review.comment` cannot see reviews at all, so for them every song in a review stage counts as waiting.
   */
  waiting: number;
  /** Songs in the review stages that have at least one review, or null when the member may not read reviews. */
  reviewed: number | null;
  /** Releases of this artist that are still drafts / went out. */
  draftReleases: number;
  /** Drafts whose creative approval is open (asked, or changed since). 0 when the gate is off. */
  creativeOpen: number;
};

/** What the browser gets: the brief, never the stored direction document itself. */
export type ArtistCard = Omit<ArtistCardInput, 'direction'> & { brief: DirectionBrief };

/**
 * One card per roster artist. Order: artists with creative work waiting first (creative approvals open, then songs
 * waiting for review), then the ones with no direction written yet (a gap the team should close), then by name.
 */
export function buildArtistCards(inputs: readonly ArtistCardInput[]): ArtistCard[] {
  const cards = inputs.map((i): ArtistCard => {
    const { direction, ...rest } = i;
    return { ...rest, brief: directionBrief(direction) };
  });
  return cards.sort(
    (a, b) =>
      b.creativeOpen - a.creativeOpen ||
      b.waiting - a.waiting ||
      Number(a.brief.filled > 0) - Number(b.brief.filled > 0) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

// ── Releases and the creative gate ──────────────────────────────────────

export type CreativeStatus = { status: GateStatus; stale: boolean };

export type CreativeReleaseInput = {
  id: string;
  title: string;
  state: string;
  artistId: string | null;
  artistName: string | null;
  targetDate: string | null;
  releaseDate: string | null;
  createdAt: string;
  /** null = the org has the creative gate off (or the release is not a draft), so there is nothing to show. */
  creative: CreativeStatus | null;
};

export type CreativeRelease = CreativeReleaseInput;

const GATE_ORDER: Record<string, number> = { awaiting_approval: 0, stale: 1, blocked: 2, not_started: 3, approved: 4, satisfied: 4, not_required: 5 };

/** Is the creative gate holding this release back? Anything but a current approval. */
export function creativeOpen(c: CreativeStatus | null): boolean {
  if (!c) return false;
  return !['approved', 'satisfied', 'not_required'].includes(c.status) || c.stale;
}

/** Releases that need the creative team first: asked and unanswered, changed since approved, changes requested, not yet asked; then by date. */
export function sortCreativeReleases(rows: readonly CreativeReleaseInput[]): CreativeRelease[] {
  const date = (r: CreativeReleaseInput) => r.releaseDate ?? r.targetDate;
  return [...rows].sort((a, b) => {
    const ra = a.creative ? GATE_ORDER[a.creative.status] ?? 6 : 7;
    const rb = b.creative ? GATE_ORDER[b.creative.status] ?? 6 : 7;
    if (ra !== rb) return ra - rb;
    const da = date(a);
    const db = date(b);
    if (da && db && da !== db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

export const CREATIVE_STATUS_WORD: Record<string, string> = {
  not_started: 'Not asked yet',
  blocked: 'Changes requested',
  awaiting_approval: 'Awaiting creative approval',
  approved: 'Creatively approved',
  satisfied: 'Creatively approved',
  not_required: 'Not required',
  stale: 'Changed since approved',
};

export function creativeStatusWord(c: CreativeStatus): string {
  return c.stale ? CREATIVE_STATUS_WORD.stale : CREATIVE_STATUS_WORD[c.status] ?? c.status;
}

// ── The page's whole answer ─────────────────────────────────────────────

export type CreativeWorkspace = {
  /** False before the migrations the sources need (152 direction); the rest is read from whatever exists. */
  schemaReady: boolean;
  /** The optional creative approval gate is on for this org. */
  gate: boolean;
  /** The viewer may decide the creative gate (`creative.approve`). */
  canApprove: boolean;
  /** The viewer may write direction (`catalog.write`): links open the editor. */
  canWrite: boolean;
  artists: ArtistCard[];
  releases: CreativeRelease[];
  /** Songs the member may not read (D4), counted for a viewer allowed to see such counts; 0 otherwise. Never named. */
  restricted: number;
  /** Totals over what the member can see. */
  totals: { artists: number; withDirection: number; songsWaiting: number; creativeOpen: number };
};

export function workspaceTotals(artists: readonly ArtistCard[], releases: readonly CreativeRelease[]): CreativeWorkspace['totals'] {
  return {
    artists: artists.length,
    withDirection: artists.filter((a) => a.brief.filled > 0).length,
    songsWaiting: artists.reduce((n, a) => n + a.waiting, 0),
    creativeOpen: releases.filter((r) => creativeOpen(r.creative)).length,
  };
}
