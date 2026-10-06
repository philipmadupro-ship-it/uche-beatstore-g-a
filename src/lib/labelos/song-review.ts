/**
 * Song reviews and the A&R inbox's rules (LABEL-25, 04 W3, 07 §2.4). Pure: the
 * route, the store and the inbox screen all read this, so none of them owns a
 * copy of "who may review", "what a review needs" or "what a key does".
 *
 * A review is one reviewer's rating (1–5), verdict and note on one song
 * (`song_reviews`, mig 149): one row per (song, reviewer), so two A&Rs never
 * overwrite each other. It is distinct from `contact_track_states`, the
 * RECIPIENT's decision on a beat (17 R7). The song's stage is a separate,
 * explicit move (`song-stage.ts`): a verdict does not move the song.
 */
import { allowedTransitions, isSongStage, type SongStage } from './song-stage';
import type { Capability, Role } from './capabilities';

/** Same values as `song_reviews_verdict_check` (the local check holds them equal). */
export const REVIEW_VERDICTS = ['shortlist', 'hold', 'pass', 'changes_requested'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const REVIEW_VERDICT_LABEL: Record<ReviewVerdict, string> = {
  shortlist: 'Shortlist',
  hold: 'Hold',
  pass: 'Pass',
  changes_requested: 'Changes requested',
};

export const RATINGS = [1, 2, 3, 4, 5] as const;
export const NOTE_MAX = 2000;

export function isReviewVerdict(v: unknown): v is ReviewVerdict {
  return typeof v === 'string' && (REVIEW_VERDICTS as readonly string[]).includes(v);
}

/** What one reviewer said. Each part may be absent; at least one is present. */
export type ReviewContent = { rating: number | null; verdict: ReviewVerdict | null; note: string | null };

/** A request's fields: omitted keeps what is there, `null` clears it. */
export type ReviewPatch = { rating?: number | null; verdict?: ReviewVerdict | null; note?: string | null };

const trimNote = (n: string | null | undefined): string | null => {
  const t = (n ?? '').trim();
  return t.length > 0 ? t : null;
};

/** The review after a patch: the pure half of "upsert MY review". */
export function mergeReview(current: ReviewContent | null, patch: ReviewPatch): ReviewContent {
  const base: ReviewContent = current ?? { rating: null, verdict: null, note: null };
  return {
    rating: patch.rating === undefined ? base.rating : patch.rating,
    verdict: patch.verdict === undefined ? base.verdict : patch.verdict,
    note: patch.note === undefined ? trimNote(base.note) : trimNote(patch.note),
  };
}

/** An empty review is not a row (`song_reviews_not_empty`). */
export function validReview(r: ReviewContent): boolean {
  return r.rating !== null || r.verdict !== null || r.note !== null;
}

/**
 * Rating, verdict and a note are `review.write`'s (06 §2.6 matrix): owner and
 * admin, A&R, project manager, artist manager. A roster artist holds only
 * `review.comment` ("comment only"), marketing and legal nothing, so they READ
 * the reviews of their songs (D5) and cannot add one.
 */
export function mayReview(caps: ReadonlySet<Capability | string>): boolean {
  return caps.has('review.write');
}

export type ReviewSummary = {
  count: number;
  /** Reviews that carry a rating. */
  rated: number;
  /** Mean of the ratings that exist, null without any. */
  average: number | null;
  verdicts: Record<ReviewVerdict, number>;
};

export function summarizeReviews(reviews: ReadonlyArray<Pick<ReviewContent, 'rating' | 'verdict'>>): ReviewSummary {
  const verdicts: Record<ReviewVerdict, number> = { shortlist: 0, hold: 0, pass: 0, changes_requested: 0 };
  let sum = 0;
  let rated = 0;
  for (const r of reviews) {
    if (r.verdict) verdicts[r.verdict] += 1;
    if (r.rating !== null) {
      sum += r.rating;
      rated += 1;
    }
  }
  return { count: reviews.length, rated, average: rated > 0 ? sum / rated : null, verdicts };
}

// ── The inbox ───────────────────────────────────────────────────────────

/** 04 W3 step 3: the inbox lists songs in `inbox` and `in_review`. */
export const INBOX_STAGES: readonly SongStage[] = ['inbox', 'in_review'];

/** The inbox's songs, oldest first (the one that has waited longest leads); the id breaks ties so the order is stable. */
export function sortInbox<T extends { id: string; stage: string | null; created_at: string }>(songs: readonly T[]): T[] {
  return songs
    .filter((s) => (INBOX_STAGES as readonly (string | null)[]).includes(s.stage))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export type KeyInput = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** Focus is in an input, textarea or contenteditable. */
  typing: boolean;
};

export type InboxAction =
  | { kind: 'move'; delta: 1 | -1 }
  | { kind: 'play' }
  | { kind: 'rate'; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'stage'; to: SongStage }
  | { kind: 'comment' }
  | { kind: 'select' };

/**
 * What a key does in the inbox (07 §2.4): J/K next and previous, Space play,
 * 1–5 rate, S shortlist, H hold, P pass, C comment — plus R "start review"
 * (inbox → in review: the transition table has no way from Inbox to
 * Shortlisted, so the review has to begin before S is allowed) and X to select
 * a row for the bulk bar. Nothing fires while typing or with a modifier held
 * (⌘/Ctrl/Alt keep their browser meaning; the transport's own Shift shortcuts
 * are not ours). The stage keys are only a request: whether the move is
 * allowed is `offeredStageKeys`.
 */
export function inboxKeyAction(e: KeyInput): InboxAction | null {
  if (e.typing || e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case 'j': case 'J': return { kind: 'move', delta: 1 };
    case 'k': case 'K': return { kind: 'move', delta: -1 };
    case ' ': return { kind: 'play' };
    case '1': case '2': case '3': case '4': case '5': return { kind: 'rate', value: Number(e.key) as 1 | 2 | 3 | 4 | 5 };
    case 's': case 'S': return { kind: 'stage', to: 'shortlisted' };
    case 'h': case 'H': return { kind: 'stage', to: 'on_hold' };
    case 'p': case 'P': return { kind: 'stage', to: 'passed' };
    case 'r': case 'R': return { kind: 'stage', to: 'in_review' };
    case 'c': case 'C': return { kind: 'comment' };
    case 'x': case 'X': return { kind: 'select' };
    default: return null;
  }
}

/** The stage keys that would work for a song in `stage`: LABEL-24's transition table for this member, nothing re-implemented. */
export function offeredStageKeys(stage: string | null, caps: ReadonlySet<Capability>, role?: Role | string | null): SongStage[] {
  if (!isSongStage(stage)) return [];
  const keyed: readonly SongStage[] = ['in_review', 'shortlisted', 'on_hold', 'passed'];
  return allowedTransitions(stage, caps, role).filter((s) => keyed.includes(s));
}

/**
 * Where the cursor goes when rows leave the list (a stage move takes the song
 * out of the inbox): the next remaining row after the current one, else the
 * one before it, else nothing. A cursor that is not in the list stays put.
 */
export function cursorAfterRemoval(ids: readonly string[], current: string | null, removed: ReadonlySet<string>): string | null {
  const remaining = ids.filter((id) => !removed.has(id));
  if (current === null) return remaining[0] ?? null;
  if (!removed.has(current) && remaining.includes(current)) return current;
  const at = ids.indexOf(current);
  if (at < 0) return remaining[0] ?? null;
  return ids.slice(at + 1).find((id) => !removed.has(id)) ?? [...ids.slice(0, at)].reverse().find((id) => !removed.has(id)) ?? null;
}
