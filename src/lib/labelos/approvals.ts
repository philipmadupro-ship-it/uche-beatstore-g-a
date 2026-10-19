/**
 * Approvals (LABEL-30, 05 §3, 09 §2–3): the human decision at a release gate,
 * stored append-only with a snapshot of what was approved.
 *
 * An approval is a FACT, not a state. Every request and every decision is a
 * new row in `approvals` (migration 157: INSERT only, no UPDATE or DELETE for
 * anyone); "where does this gate stand" is `currentDecision(rows)`, the latest
 * row. An approval row carries `subject_snapshot` — the split sheet versions
 * and credits (legal), the artwork file, the tracklist — and "is it still
 * good" is `isStale(snapshot, current)`, derived on every read. Nothing marks
 * an approval stale; changing a split after it was approved makes the two
 * snapshots differ, which is the whole mechanism (09 §3.3: "approved, then
 * splits changed" cannot happen quietly).
 *
 * Pure. The store loads the facts and builds the snapshot with
 * `buildSnapshot`; the routes call `planRequest` / `planDecide` for the
 * answer and the Postgres function (audit RPC) re-checks the one rule the
 * database can know for itself (a requester approving their own request).
 *
 * Gates (06 §2.1, 09 §2): `master`, `artwork`, `legal`, `marketing`,
 * `metadata`, each decided by the capability `release.approve.<gate>`. A SONG
 * is asked only for `legal` (the legal queue holds "songs/releases with
 * requested", 09 §3.3); the other four belong to a release. This module adds
 * no gate beyond the spec. The only gate with a precondition is `legal`: an
 * approval can be RECORDED only when legal readiness has no blockers
 * (`isReady`, never the percentage — 09 §2); asking for one, and asking for
 * changes, are allowed at any time.
 */
import type { Capability } from './capabilities';
import { isLive } from './splits';

// ── Vocabulary ──────────────────────────────────────────────────────────

export const GATES = ['master', 'artwork', 'legal', 'marketing', 'metadata'] as const;
export type Gate = (typeof GATES)[number];

/** The decisions a person records. Frame.io vocabulary (09 §6). */
export const DECISIONS = ['approved', 'changes_requested'] as const;
export type Decision = (typeof DECISIONS)[number];

/** What a row can hold: a request, or one of the decisions. */
export const ROW_DECISIONS = ['requested', ...DECISIONS] as const;
export type RowDecision = (typeof ROW_DECISIONS)[number];

export const SUBJECT_KINDS = ['song', 'release'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** The gates a song can be asked for; a release takes all five. */
export const SONG_GATES: readonly Gate[] = ['legal'];

export const GATE_LABEL: Record<Gate, string> = {
  master: 'Master',
  artwork: 'Artwork',
  legal: 'Legal',
  marketing: 'Marketing',
  metadata: 'Metadata',
};

export const DECISION_LABEL: Record<Decision, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

export const NOTE_MAX = 2000;

export const isGate = (v: unknown): v is Gate => typeof v === 'string' && (GATES as readonly string[]).includes(v);
export const isDecision = (v: unknown): v is Decision => typeof v === 'string' && (DECISIONS as readonly string[]).includes(v);
export const isSubjectKind = (v: unknown): v is SubjectKind => typeof v === 'string' && (SUBJECT_KINDS as readonly string[]).includes(v);

/** `release.approve.<gate>`. */
export const gateCapability = (gate: Gate): Capability => `release.approve.${gate}` as Capability;

export const gatesFor = (kind: SubjectKind): readonly Gate[] => (kind === 'song' ? SONG_GATES : GATES);
export const gateAppliesTo = (kind: SubjectKind, gate: Gate): boolean => gatesFor(kind).includes(gate);

/** Owner and admin may do what the rules deny to everyone else (D4 note): approve their own request. */
export const isOwnerOrAdmin = (role: string): boolean => role === 'owner' || role === 'admin';

// ── Rows ────────────────────────────────────────────────────────────────

export type ApprovalRow = {
  id: string;
  org_id: string;
  song_id: string | null;
  release_id: string | null;
  gate: string;
  decision: string;
  note: string | null;
  /** Who requested (decision `requested`) or decided. */
  actor_id: string | null;
  /** On a request: the one person asked. */
  approver_id: string | null;
  /** On a decision: the request it answers, when there was one. */
  request_id: string | null;
  subject_snapshot: unknown;
  created_at: string;
};

export const APPROVAL_COLUMNS = 'id, org_id, song_id, release_id, gate, decision, note, actor_id, approver_id, request_id, subject_snapshot, created_at';

export type CurrentApproval = {
  /** `none` = never asked; `requested` = asked and unanswered (also after an approval, which a new request re-opens). */
  status: 'none' | 'requested' | 'approved' | 'changes_requested';
  /** The latest row of any kind. */
  latest: ApprovalRow | null;
  /** The latest approved / changes_requested row, even when a newer request re-opened the gate. */
  decided: ApprovalRow | null;
  /** The request still waiting for an answer. */
  pending: ApprovalRow | null;
};

/**
 * Where one (subject, gate) stands: its latest row decides (05 §3). `rows` are
 * all the rows of ONE subject and gate, in any order; a request that came
 * after a decision re-opens the gate (`status` is `requested`), though the
 * earlier decision stays in `decided`. Ties on the timestamp resolve to the
 * later position in `rows`, so a caller passing insertion order is stable.
 */
export function currentDecision(rows: readonly ApprovalRow[]): CurrentApproval {
  const ordered = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.created_at.localeCompare(b.row.created_at) || a.i - b.i)
    .map((x) => x.row);
  const latest = ordered.length ? ordered[ordered.length - 1] : null;
  if (!latest) return { status: 'none', latest: null, decided: null, pending: null };
  const decided = [...ordered].reverse().find((r) => r.decision === 'approved' || r.decision === 'changes_requested') ?? null;
  if (latest.decision === 'requested') return { status: 'requested', latest, decided, pending: latest };
  return { status: latest.decision === 'approved' ? 'approved' : 'changes_requested', latest, decided: latest, pending: null };
}

/** `currentDecision` per gate, over the mixed rows of one subject. */
export function currentByGate(rows: readonly ApprovalRow[]): Map<Gate, CurrentApproval> {
  const out = new Map<Gate, CurrentApproval>();
  for (const gate of GATES) out.set(gate, currentDecision(rows.filter((r) => r.gate === gate)));
  return out;
}

// ── Snapshot ────────────────────────────────────────────────────────────

export type SnapshotSong = {
  id: string;
  /** Split sheets in force (circulated, signed or disputed): which VERSION was agreed. */
  sheets: { id: string; kind: string; version: number }[];
  /** Credits and where each stands (09 §3.3: credit ids + statuses). */
  credits: { id: string; status: string; partyId: string | null }[];
};

export type SnapshotItem = { songId: string; masterId: string };

/** What one track carries to a distributor (09 §4 metadata gate): the master's ISRC, the explicit flag, the version title. */
export type SnapshotDetail = { songId: string; isrc: string | null; explicit: boolean; versionTitle: string | null };

/** What the store loaded about the subject. Gates read only the parts they name. */
export type SnapshotFacts = {
  songs?: readonly SnapshotSong[];
  artworkAssetId?: string | null;
  items?: readonly SnapshotItem[];
  /** Per tracklist item, in tracklist order (metadata gate). */
  details?: readonly SnapshotDetail[];
  /** The metadata a distributor is sent (09 §4), as plain strings. */
  release?: Readonly<Record<string, string | null>>;
};

/**
 * One song's part of the facts, from its split sheets (every version, any
 * status — only the ones in force count, LABEL-28's `isLive`) and its credits.
 * A draft being negotiated is not what was agreed; a superseded version is
 * not either — which is why circulating a new version changes the snapshot.
 */
export function songSnapshotFacts(
  songId: string,
  sheets: readonly { id: string; kind: string; version: number; status: string }[],
  credits: readonly { id: string; status: string; party_id: string | null }[],
): SnapshotSong {
  return {
    id: songId,
    sheets: sheets.filter((s) => isLive(s.status)).map((s) => ({ id: s.id, kind: s.kind, version: s.version })),
    credits: credits.map((c) => ({ id: c.id, status: c.status, partyId: c.party_id })),
  };
}

export const SNAPSHOT_VERSION = 1;

type PartName = 'songs' | 'artwork' | 'items' | 'release' | 'details';

/** Which parts of the facts a gate's approval covers. Marketing is a sign-off with nothing underneath it. */
export const SNAPSHOT_PARTS: Readonly<Record<Gate, readonly PartName[]>> = {
  legal: ['songs'],
  artwork: ['artwork'],
  master: ['items'],
  metadata: ['items', 'release', 'details'],
  marketing: [],
};

export type Snapshot = { v: typeof SNAPSHOT_VERSION; gate: Gate; parts: Partial<Record<PartName, unknown>> };

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

function canonicalSong(s: SnapshotSong): SnapshotSong {
  return {
    id: s.id,
    sheets: [...s.sheets].map((x) => ({ id: x.id, kind: x.kind, version: x.version })).sort(byId),
    credits: [...s.credits].map((x) => ({ id: x.id, status: x.status, partyId: x.partyId ?? null })).sort(byId),
  };
}

/**
 * The snapshot stored with a decision: exactly the parts the gate covers, in
 * a canonical order (sorted ids, sorted keys), so two builds of the same
 * facts are equal and a reordered row is not a change. Run it at decision
 * time; run it again later to get `current` for `isStale`.
 */
export function buildSnapshot(gate: Gate, facts: SnapshotFacts): Snapshot {
  const parts: Snapshot['parts'] = {};
  for (const name of SNAPSHOT_PARTS[gate]) {
    if (name === 'songs') parts.songs = [...(facts.songs ?? [])].map(canonicalSong).sort(byId);
    else if (name === 'artwork') parts.artwork = facts.artworkAssetId ?? null;
    else if (name === 'items') {
      // Order matters: a reordered tracklist is a different release.
      parts.items = (facts.items ?? []).map((i) => ({ songId: i.songId, masterId: i.masterId }));
    } else if (name === 'details') {
      parts.details = (facts.details ?? []).map((d) => ({ songId: d.songId, isrc: d.isrc ?? null, explicit: d.explicit === true, versionTitle: d.versionTitle ?? null }));
    } else if (name === 'release') {
      parts.release = Object.fromEntries(Object.entries(facts.release ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    }
  }
  return { v: SNAPSHOT_VERSION, gate, parts };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep equality for JSON values (keys in any order, arrays in order). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return false;
}

/** The parts that differ between what was approved and what is there now. Empty = still good. */
export function changedParts(snapshot: unknown, current: Snapshot): string[] {
  // Something we cannot read cannot vouch for anything: stale, and every part named.
  if (!isRecord(snapshot) || snapshot.v !== SNAPSHOT_VERSION || snapshot.gate !== current.gate || !isRecord(snapshot.parts)) {
    return [...SNAPSHOT_PARTS[current.gate]].length ? [...SNAPSHOT_PARTS[current.gate]] : ['snapshot'];
  }
  const approved = snapshot.parts;
  return SNAPSHOT_PARTS[current.gate].filter((name) => !sameJson(approved[name], current.parts[name]));
}

/**
 * Has what was approved changed since? Derived, never stored. A snapshot that
 * is missing, of another version or of another gate counts as stale: an
 * approval that cannot say what it covered covers nothing.
 */
export function isStale(snapshot: unknown, current: Snapshot): boolean {
  if (!isRecord(snapshot) || snapshot.v !== SNAPSHOT_VERSION || snapshot.gate !== current.gate || !isRecord(snapshot.parts)) return true;
  return changedParts(snapshot, current).length > 0;
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isRecord(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/**
 * A short token for "the facts as an approver saw them": equal exactly when the
 * snapshots are equal (keys in any order). The decide route compares the token
 * the screen was drawn from (`seen`) with the facts as they are when the
 * request arrives, so an approval records what the person looked at and not
 * whatever a colleague changed in between. A change token, not a secret: any
 * 53-bit hash will do (cyrb53).
 */
export function snapshotKey(snapshot: Snapshot): string {
  const text = stableJson(snapshot);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Only an approval can be stale; a request and a change request say nothing about content. */
export function approvalIsStale(current: CurrentApproval, now: Snapshot): boolean {
  return current.status === 'approved' && !!current.latest && isStale(current.latest.subject_snapshot, now);
}

// ── Rules ───────────────────────────────────────────────────────────────

export type Actor = { id: string; role: string; capabilities: ReadonlySet<string> };

export type Plan<T = object> = ({ ok: true } & T) | { ok: false; status: 400 | 403 | 409 | 422; error: string; code: string };

const refuse = (status: 400 | 403 | 409 | 422, code: string, error: string) => ({ ok: false as const, status, code, error });

/**
 * Anyone who manages the release or the rights can ask (a PM sends a release
 * to legal, a legal member asks A&R for a master); holding the gate's own
 * capability also lets a gate keeper ask for one.
 */
export function mayRequest(actor: Actor, gate: Gate): boolean {
  return actor.capabilities.has('release.write') || actor.capabilities.has('rights.write') || actor.capabilities.has(gateCapability(gate));
}

export type RequestInput = {
  kind: SubjectKind;
  gate: string;
  actor: Actor;
  approverId: string;
  /** Whether that person may decide the gate, here (membership, scope and capability: the route asked). */
  approverMayDecide: boolean;
  current: CurrentApproval;
  note?: string | null;
};

/**
 * May this person ask that one for this gate. Allowed with legal blockers
 * (09 §3.3 — they are listed in the request); refused when the gate does not
 * exist for this subject, when it is already waiting on someone, when the
 * approver cannot decide it, and when a non-owner asks themselves (nobody
 * could ever answer: they cannot approve their own request).
 */
export function planRequest(input: RequestInput): Plan<{ gate: Gate }> {
  if (!isGate(input.gate)) return refuse(400, 'bad_gate', 'Unknown gate');
  const gate = input.gate;
  if (!gateAppliesTo(input.kind, gate)) return refuse(400, 'bad_gate', `A ${input.kind} is not approved at the ${gate} gate`);
  if (!mayRequest(input.actor, gate)) return refuse(403, 'forbidden', 'You cannot ask for approvals here');
  if ((input.note ?? '').length > NOTE_MAX) return refuse(400, 'note_too_long', `A note is at most ${NOTE_MAX} characters`);
  if (input.current.status === 'requested') return refuse(409, 'already_requested', 'This is already waiting for an answer');
  if (!input.approverMayDecide) return refuse(422, 'approver_cannot_decide', `That person cannot approve the ${GATE_LABEL[gate].toLowerCase()} gate`);
  if (input.approverId === input.actor.id && !isOwnerOrAdmin(input.actor.role)) {
    return refuse(422, 'ask_someone_else', 'Ask someone else: you cannot approve your own request');
  }
  return { ok: true, gate };
}

/**
 * Why this person cannot press "Approved" on the gate as it stands, from who
 * asked and who was asked (doc 21 #15). Owners and admins are exempt from
 * both rules. Anyone else needs an OPEN request addressed to them (a request
 * that was answered is closed, a new decision needs a new request) and cannot
 * answer one they made themselves. `null` = nothing in the way. The one copy
 * of the rule: `planDecide` refuses on it and the gate state tells the screen.
 */
export function approveBlocker(actor: Pick<Actor, 'id' | 'role'>, pending: ApprovalRow | null): { code: 'self_approval' | 'no_request'; message: string } | null {
  if (isOwnerOrAdmin(actor.role)) return null;
  const me = actor.id.toLowerCase();
  if (pending && pending.actor_id?.toLowerCase() === me) return { code: 'self_approval', message: 'You cannot approve a request you made yourself' };
  if (!pending || pending.approver_id?.toLowerCase() !== me) return { code: 'no_request', message: 'Approving needs a request addressed to you. Ask for one first.' };
  return null;
}

export type DecideInput = {
  kind: SubjectKind;
  gate: string;
  decision: string;
  note?: string | null;
  actor: Actor;
  current: CurrentApproval;
  /** `approvalIsStale(current, now)`. */
  stale: boolean;
  /** Legal only: `isReady(readiness)` of every song covered. Anything else: undefined. */
  legalReady?: boolean;
  /** The number of legal blockers, for the message. */
  legalBlockers?: number;
  /** What the decider's screen was drawn from (`snapshotKey` of the gate, sent by the client). Approving needs it (doc 21 #14). */
  seen: string | null | undefined;
  /** `snapshotKey` of the gate's facts as they are now. */
  currentKey: string;
  /** A song that is on a release: its legal approval is the release's (doc 21 #13). Ignored for a release. */
  songOnRelease: boolean;
};

/**
 * May this person record this decision. Order matters: the capability first
 * (403 before anything about the gate's state), then the input, then state.
 *
 *  - needs `release.approve.<gate>`;
 *  - "Changes requested" needs a note (what to change);
 *  - "Approved" must carry `seen`, the key of what the approver's screen showed
 *    (doc 21 #14): none is a 400, one that no longer matches the facts a 409
 *    `changed_since_seen`, so an approval records what was looked at;
 *  - approving needs an open request addressed to the decider, and nobody
 *    answers their own — owner and admin are exempt from both (`approveBlocker`,
 *    doc 21 #15 and the D4 note). Declining is fine either way;
 *  - a SONG's legal gate is not approved once the song is on a release: the
 *    release's legal gate is the authority (doc 21 #13). Changes can still be
 *    requested;
 *  - `legal` is recorded as approved only while the readiness has no blockers;
 *  - approving what is approved and unchanged is a 409 (an approval of
 *    something stale is the way to renew it).
 */
export function planDecide(input: DecideInput): Plan<{ gate: Gate; decision: Decision; requestId: string | null }> {
  if (!isGate(input.gate)) return refuse(400, 'bad_gate', 'Unknown gate');
  const gate = input.gate;
  if (!gateAppliesTo(input.kind, gate)) return refuse(400, 'bad_gate', `A ${input.kind} is not approved at the ${gate} gate`);
  if (!input.actor.capabilities.has(gateCapability(gate))) return refuse(403, 'forbidden', `You cannot decide the ${GATE_LABEL[gate].toLowerCase()} gate`);
  if (!isDecision(input.decision)) return refuse(400, 'bad_decision', 'Choose Approved or Changes requested');
  const note = (input.note ?? '').trim();
  if (note.length > NOTE_MAX) return refuse(400, 'note_too_long', `A note is at most ${NOTE_MAX} characters`);
  if (input.decision === 'changes_requested' && note.length === 0) return refuse(400, 'note_required', 'Say what needs to change');

  const pending = input.current.pending;
  if (input.decision === 'approved') {
    if (!input.seen || input.seen.trim().length === 0) return refuse(400, 'seen_required', 'Open it and look before approving');
    const blocked = approveBlocker(input.actor, pending);
    if (blocked) return refuse(403, blocked.code, blocked.message);
    if (input.kind === 'song' && gate === 'legal' && input.songOnRelease) {
      return refuse(409, 'decided_on_release', 'This song is on a release. Legal is approved on the release.');
    }
    if (input.current.status === 'approved' && !input.stale) return refuse(409, 'already_approved', 'This is already approved');
    if (gate === 'legal' && input.legalReady === false) {
      const n = input.legalBlockers ?? 0;
      return refuse(422, 'legal_blockers', n > 0 ? `Legal readiness has ${n} blocker${n === 1 ? '' : 's'}; clear them before approving` : 'Legal readiness has blockers; clear them before approving');
    }
    if (input.seen !== input.currentKey) return refuse(409, 'changed_since_seen', 'This changed after you opened it. Look at it again before approving.');
  }
  return { ok: true, gate, decision: input.decision, requestId: pending?.id ?? null };
}

// ── Display ─────────────────────────────────────────────────────────────

export type ChipTone = 'neutral' | 'waiting' | 'good' | 'warn';

/** The one-line status the song view shows next to a gate. */
export function approvalChip(current: CurrentApproval, stale: boolean): { label: string; tone: ChipTone } {
  if (current.status === 'approved') {
    return stale ? { label: 'Stale — changed since approval', tone: 'warn' } : { label: DECISION_LABEL.approved, tone: 'good' };
  }
  if (current.status === 'changes_requested') return { label: DECISION_LABEL.changes_requested, tone: 'warn' };
  if (current.status === 'requested') return { label: current.decided?.decision === 'approved' ? 'Asked again' : 'Awaiting approval', tone: 'waiting' };
  return { label: 'Not requested', tone: 'neutral' };
}
