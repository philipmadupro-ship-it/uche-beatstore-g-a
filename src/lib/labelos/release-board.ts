/**
 * The release board's rows and filters (LABEL-33, 07 §2.5). Pure: the server
 * read (`release-board-store`) builds `BoardRelease`s from the LABEL-32
 * readiness; this module orders and filters them. A board is a LIST with a
 * gate strip per release — there is deliberately no way to drag a release to
 * a stage: stages are derived from the gates, never set by hand (07 §2.5).
 */
import { RELEASE_GATES, type GateStatus, type ReleaseGate } from './release-readiness';

export type BoardGate = { gate: ReleaseGate; status: GateStatus; blockerCount: number };

export type BoardRelease = {
  id: string;
  title: string;
  type: string;
  state: string;
  artistId: string;
  artistName: string | null;
  targetDate: string | null;
  releaseDate: string | null;
  deliveredAt: string | null;
  deliveredTo: string | null;
  itemCount: number;
  /** Seven gates in `RELEASE_GATES` order; empty for a delivered or cancelled release (nothing left to gate). */
  gates: BoardGate[];
  readyToDeliver: boolean;
  createdAt: string;
};

export const BOARD_FILTERS = ['all', 'ready', 'in_progress', 'delivered', 'withdrawn', 'cancelled'] as const;
export type BoardFilter = (typeof BOARD_FILTERS)[number];

export const BOARD_FILTER_LABEL: Record<BoardFilter, string> = {
  all: 'All',
  ready: 'Ready to deliver',
  in_progress: 'In progress',
  delivered: 'Delivered',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

/** Where a release stands on the board. Derived, never stored. */
export function boardStage(r: Pick<BoardRelease, 'state' | 'readyToDeliver'>): Exclude<BoardFilter, 'all'> {
  if (r.state === 'delivered') return 'delivered';
  if (r.state === 'withdrawn') return 'withdrawn';
  if (r.state === 'cancelled') return 'cancelled';
  return r.readyToDeliver ? 'ready' : 'in_progress';
}

export function isBoardFilter(v: unknown): v is BoardFilter {
  return typeof v === 'string' && (BOARD_FILTERS as readonly string[]).includes(v);
}

export function filterBoard(rows: readonly BoardRelease[], filter: BoardFilter): BoardRelease[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => boardStage(r) === filter);
}

export function countByFilter(rows: readonly BoardRelease[]): Record<BoardFilter, number> {
  const counts = { all: rows.length, ready: 0, in_progress: 0, delivered: 0, withdrawn: 0, cancelled: 0 } as Record<BoardFilter, number>;
  for (const r of rows) counts[boardStage(r)] += 1;
  return counts;
}

const STAGE_ORDER: Record<Exclude<BoardFilter, 'all'>, number> = { ready: 0, in_progress: 1, delivered: 2, withdrawn: 3, cancelled: 4 };

/**
 * What needs attention first: ready, then in progress (nearest date first,
 * undated last), then the ones that went out (latest first), then cancelled.
 */
export function sortBoard(rows: readonly BoardRelease[]): BoardRelease[] {
  const date = (r: BoardRelease) => r.releaseDate ?? r.targetDate;
  return [...rows].sort((a, b) => {
    const sa = boardStage(a);
    const sb = boardStage(b);
    if (sa !== sb) return STAGE_ORDER[sa] - STAGE_ORDER[sb];
    if (sa === 'delivered' || sa === 'withdrawn') return (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? '');
    const da = date(a);
    const db = date(b);
    if (da && db && da !== db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

/** "2 of 7 gates open" — what the strip says in words, for the row and for assistive tech. */
export function gateSummary(gates: readonly BoardGate[]): string {
  if (gates.length === 0) return '';
  const open = gates.filter((g) => !['approved', 'satisfied', 'not_required'].includes(g.status)).length;
  return open === 0 ? 'All gates satisfied' : `${open} of ${gates.length} gates open`;
}

/** Short names for the strip (the label is `RELEASE_GATE_LABEL`; the strip has no room). */
export const GATE_SHORT: Record<ReleaseGate, string> = {
  tracklist: 'Tracks',
  masters: 'Masters',
  credits_splits: 'Splits',
  legal: 'Legal',
  artwork: 'Art',
  metadata: 'Meta',
  marketing: 'Mktg',
};

/** A board row built from a view of the readiness, for the store and for tests. */
export function boardGates(gates: Record<ReleaseGate, { status: GateStatus; blockerCount: number }>): BoardGate[] {
  return RELEASE_GATES.map((gate) => ({ gate, status: gates[gate].status, blockerCount: gates[gate].blockerCount }));
}

// ── How a gate reads (board strip and detail share it) ──────────────────

export type GateTone = 'good' | 'warn' | 'waiting' | 'neutral';

const GATE_WORD: Record<GateStatus, string> = {
  not_started: 'Not started',
  blocked: 'Blocked',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  satisfied: 'Done',
  not_required: 'Not required',
  stale: 'Changed since approved',
};

const GATE_TONE: Record<GateStatus, GateTone> = {
  not_started: 'neutral',
  blocked: 'warn',
  awaiting_approval: 'waiting',
  approved: 'good',
  satisfied: 'good',
  not_required: 'neutral',
  stale: 'warn',
};

export const gateWord = (status: GateStatus): string => GATE_WORD[status];
export const gateTone = (status: GateStatus): GateTone => GATE_TONE[status];
