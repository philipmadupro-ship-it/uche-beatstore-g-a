/**
 * Release readiness gates (LABEL-32, 09 §4): where each of a release's seven
 * gates stands, DERIVED on every read from the release, its tracklist, the
 * songs' legal readiness (LABEL-29), the append-only approvals and their
 * snapshots (LABEL-30) and the org's switches. Nothing here is stored; like
 * `legal-readiness.ts` it classifies the whole catalogue retroactively and
 * cannot go stale.
 *
 * Pure. `release-readiness-store.ts` loads the facts; the route decides who
 * may see which blocker (`releaseReadinessView`).
 *
 * GATES USE BLOCKERS, NEVER A PERCENTAGE. A gate is satisfied when it has no
 * blocker (and, for the five that need a person, a CURRENT approval).
 *
 * Judgement calls the spec leaves open (all flagged in the PR):
 *  - `credits_splits` has no switch; `legal_gate = 'off'` skips only the legal
 *    APPROVAL (09 §4: "credits_splits satisfied and current legal approval,
 *    skipped if off"). Songs with legal blockers still hold the release back.
 *  - A recording is a master when the song links it as `master` or
 *    `instrumental`, or as `version` (the clean cut); the song's own mix is not.
 *  - The artwork rule of 09 §4 (JPEG or PNG, square, RGB, at least
 *    `settings.artwork_min_px`, default 3000) is checked on the file's own
 *    header (`image-size.ts`; no dimension is stored). A file whose header
 *    cannot be read is a blocker: a gate that cannot check does not pass.
 *  - The explicit flag is a NOT NULL boolean, so it is always "set".
 *  - A cancelled release gates nothing (`not_required`); a delivered one still
 *    shows its gates but is never "ready to deliver" again.
 */
import { approvalIsStale, changedParts, gateCapability, type CurrentApproval, type Gate, type Snapshot } from './approvals';
import type { Capability } from './capabilities';
import { isReady, type LegalReadiness } from './legal-readiness';
import { artworkSizeProblems, type ImageInfo } from './image-size';
import { positionsContiguous } from './releases';
import type { OrgReadinessSettings } from '@/lib/contracts';

export const RELEASE_GATES = ['tracklist', 'masters', 'credits_splits', 'legal', 'artwork', 'metadata', 'marketing'] as const;
export type ReleaseGate = (typeof RELEASE_GATES)[number];

export type GateStatus = 'not_started' | 'blocked' | 'awaiting_approval' | 'approved' | 'satisfied' | 'not_required' | 'stale';

/** The approval gate behind a release gate, for the five that need a person. */
export const APPROVAL_GATE: Partial<Record<ReleaseGate, Gate>> = {
  masters: 'master',
  legal: 'legal',
  artwork: 'artwork',
  metadata: 'metadata',
  marketing: 'marketing',
};

export const RELEASE_GATE_LABEL: Record<ReleaseGate, string> = {
  tracklist: 'Tracklist',
  masters: 'Masters',
  credits_splits: 'Credits & splits',
  legal: 'Legal',
  artwork: 'Artwork',
  metadata: 'Metadata',
  marketing: 'Marketing',
};

/** What a distributor accepts as cover art. */
export const ARTWORK_MIME = ['image/jpeg', 'image/png'] as const;

// ── Facts ───────────────────────────────────────────────────────────────

/** How the recording that goes out as an item hangs off its song. */
export type MasterRelation = 'master' | 'instrumental' | 'version' | 'self' | null;

export type ReadinessItem = {
  id: string;
  position: number;
  songId: string;
  /** The song row exists in the org and is a song. */
  songOk: boolean;
  masterId: string;
  masterRelation: MasterRelation;
  isrc: string | null;
};

export type ReadinessApproval = {
  current: CurrentApproval;
  /** The snapshot of what the gate covers as of NOW. */
  now: Snapshot;
};

export type ReleaseReadinessFacts = {
  release: {
    state: string;
    title: string | null;
    type: string | null;
    primaryArtist: string | null;
    labelName: string | null;
    pLine: string | null;
    cLine: string | null;
    primaryGenre: string | null;
    targetDate: string | null;
    releaseDate: string | null;
    upc: string | null;
    artworkAssetId: string | null;
  };
  /** The artwork file when one is set and was found; `info` is what its header says (null = could not be read). */
  artwork: { mime: string | null; info: ImageInfo | null; sizeChecked?: boolean } | null;
  items: readonly ReadinessItem[];
  /** Legal readiness of each distinct song on the tracklist. */
  legal: ReadonlyMap<string, LegalReadiness>;
  approvals: Readonly<Record<Gate, ReadinessApproval>>;
  settings: OrgReadinessSettings;
};

// ── Result ──────────────────────────────────────────────────────────────

export type ReadinessBlocker = {
  code: string;
  message: string;
  gate: ReleaseGate;
  /** The capability that can close the gap. */
  fixCapability: Capability;
  itemId?: string;
  songId?: string;
  /** Names a person, a legal identifier or a split: only `rights.read` is told which. */
  sensitive: boolean;
};

export type ApprovalState = {
  gate: Gate;
  status: CurrentApproval['status'];
  stale: boolean;
  requestedAt: string | null;
  decidedAt: string | null;
};

export type GateState = {
  status: GateStatus;
  blockers: ReadinessBlocker[];
  warnings: ReadinessBlocker[];
  approval: ApprovalState | null;
};

export type ReleaseReadiness = {
  releaseState: string;
  gates: Record<ReleaseGate, GateState>;
  readyToDeliver: boolean;
};

// ── Evaluation ──────────────────────────────────────────────────────────

const blank = (v: string | null | undefined): boolean => !v || v.trim() === '';

const GATE_SATISFIED: readonly GateStatus[] = ['approved', 'satisfied', 'not_required'];

function approvalState(gate: Gate, a: ReadinessApproval): ApprovalState {
  return {
    gate,
    status: a.current.status,
    stale: approvalIsStale(a.current, a.now),
    requestedAt: a.current.pending?.created_at ?? null,
    decidedAt: a.current.decided?.created_at ?? null,
  };
}

const gateState = (status: GateStatus, blockers: ReadinessBlocker[] = [], warnings: ReadinessBlocker[] = [], approval: ApprovalState | null = null): GateState => ({
  status,
  blockers,
  warnings,
  approval,
});

/**
 * A gate that needs a person: `preconditions` are what must hold before an
 * approval means anything; the approval then decides between not started,
 * waiting, changes requested, stale and approved. A precondition blocker wins
 * the status (the gap is what to fix first), but a stale approval is listed
 * beside it so it is not forgotten.
 */
function approvalGate(
  rg: ReleaseGate,
  gate: Gate,
  a: ReadinessApproval,
  preconditions: ReadinessBlocker[],
  warnings: ReadinessBlocker[],
): GateState {
  const approval = approvalState(gate, a);
  const blockers = [...preconditions];
  const fix = gateCapability(gate);
  if (approval.stale) {
    const parts = changedParts(a.current.latest?.subject_snapshot, a.now);
    blockers.push({
      code: 'approval_stale',
      gate: rg,
      fixCapability: fix,
      sensitive: false,
      message: `Changed since it was approved${parts.length ? ` (${parts.join(', ')})` : ''}; it needs a new approval.`,
    });
  }
  if (a.current.status === 'changes_requested') {
    blockers.push({ code: 'changes_requested', gate: rg, fixCapability: fix, sensitive: false, message: 'Changes were requested at this gate.' });
  }
  if (preconditions.length > 0 || a.current.status === 'changes_requested') return gateState('blocked', blockers, warnings, approval);
  if (approval.stale) return gateState('stale', blockers, warnings, approval);
  if (a.current.status === 'approved') return gateState('approved', blockers, warnings, approval);
  if (a.current.status === 'requested') return gateState('awaiting_approval', blockers, warnings, approval);
  // Never asked: nothing to do yet when there is nothing to approve.
  return gateState('not_started', blockers, warnings, approval);
}

export function evaluateReleaseReadiness(facts: ReleaseReadinessFacts): ReleaseReadiness {
  const { release, items, settings } = facts;
  const ordered = [...items].sort((x, y) => x.position - y.position);
  const empty = ordered.length === 0;
  const at = (i: ReadinessItem) => `Track ${i.position}`;

  // tracklist
  const tl: ReadinessBlocker[] = [];
  const tlBlocker = (code: string, message: string, i?: ReadinessItem): ReadinessBlocker => ({
    code,
    message,
    gate: 'tracklist',
    fixCapability: 'release.write',
    sensitive: false,
    ...(i ? { itemId: i.id, songId: i.songId } : {}),
  });
  if (empty) tl.push(tlBlocker('no_tracks', 'The release has no tracks.'));
  else {
    if (!positionsContiguous(ordered.map((i) => i.position))) tl.push(tlBlocker('positions_gap', 'The track positions are not 1 to n without a gap.'));
    for (const i of ordered) if (!i.songOk) tl.push(tlBlocker('no_song', `${at(i)} is not a song.`, i));
  }
  const tracklist = gateState(tl.length ? 'blocked' : 'satisfied', tl);

  // masters
  const mb: ReadinessBlocker[] = [];
  for (const i of ordered) {
    if (i.masterRelation === 'master' || i.masterRelation === 'instrumental' || i.masterRelation === 'version') continue;
    mb.push({
      code: i.masterRelation === 'self' ? 'not_a_master' : 'master_unlinked',
      message: i.masterRelation === 'self' ? `${at(i)} goes out as the song’s own mix, not a master.` : `${at(i)}’s recording is not linked to the song as a master.`,
      gate: 'masters',
      fixCapability: 'release.write',
      sensitive: false,
      itemId: i.id,
      songId: i.songId,
    });
  }
  const masters = empty ? gateState('not_started', [], [], approvalState('master', facts.approvals.master)) : approvalGate('masters', 'master', facts.approvals.master, mb, []);

  // credits_splits: LABEL-29's blockers for every song, never its percentage.
  const cb: ReadinessBlocker[] = [];
  const cw: ReadinessBlocker[] = [];
  const seenSongs = new Set<string>();
  for (const i of ordered) {
    const legal = facts.legal.get(i.songId);
    if (!legal || seenSongs.has(i.songId)) continue;
    seenSongs.add(i.songId);
    for (const r of legal.blockers) {
      cb.push({ code: r.code, message: `${at(i)}: ${r.message}`, gate: 'credits_splits', fixCapability: r.fixCapability, itemId: i.id, songId: i.songId, sensitive: true });
    }
    for (const r of legal.warnings) {
      cw.push({ code: r.code, message: `${at(i)}: ${r.message}`, gate: 'credits_splits', fixCapability: r.fixCapability, itemId: i.id, songId: i.songId, sensitive: true });
    }
  }
  // A song with no legal facts loaded is not "ready" by omission.
  for (const i of ordered) {
    if (i.songOk && !facts.legal.has(i.songId) && !seenSongs.has(i.songId)) {
      seenSongs.add(i.songId);
      cb.push({ code: 'legal_unknown', message: `${at(i)}: legal readiness could not be worked out.`, gate: 'credits_splits', fixCapability: 'rights.write', itemId: i.id, songId: i.songId, sensitive: false });
    }
  }
  const allReady = [...facts.legal.values()].every((l) => isReady(l)) && cb.length === 0;
  const credits_splits = empty ? gateState('not_started') : gateState(allReady ? 'satisfied' : 'blocked', cb, cw);

  // legal
  let legal: GateState;
  if (settings.legal_gate === 'off') legal = gateState('not_required');
  else {
    const pre: ReadinessBlocker[] = [];
    if (!empty && credits_splits.status !== 'satisfied') {
      pre.push({
        code: 'credits_splits_open',
        message: `Credits & splits are not satisfied (${cb.length} blocker${cb.length === 1 ? '' : 's'}).`,
        gate: 'legal',
        fixCapability: 'rights.write',
        sensitive: false,
      });
    }
    legal = empty ? gateState('not_started', [], [], approvalState('legal', facts.approvals.legal)) : approvalGate('legal', 'legal', facts.approvals.legal, pre, []);
  }

  // artwork
  const ab: ReadinessBlocker[] = [];
  const art = (code: string, message: string): ReadinessBlocker => ({ code, message, gate: 'artwork', fixCapability: 'release.write', sensitive: false });
  if (!release.artworkAssetId) ab.push(art('no_artwork', 'No artwork is set.'));
  else if (!facts.artwork) ab.push(art('artwork_missing', 'The artwork file no longer exists.'));
  else if (!facts.artwork.mime || !(ARTWORK_MIME as readonly string[]).includes(facts.artwork.mime.toLowerCase())) {
    ab.push(art('artwork_type', 'The artwork must be a JPEG or PNG.'));
  } else if (facts.artwork.sizeChecked !== false) {
    for (const p of artworkSizeProblems(facts.artwork.info, settings.artwork_min_px)) ab.push(art(p.code, p.message));
  }
  const artwork = approvalGate('artwork', 'artwork', facts.approvals.artwork, ab, []);

  // metadata
  const mdb: ReadinessBlocker[] = [];
  const md = (code: string, message: string, i?: ReadinessItem): ReadinessBlocker => ({
    code,
    message,
    gate: 'metadata',
    fixCapability: 'release.write',
    sensitive: false,
    ...(i ? { itemId: i.id, songId: i.songId } : {}),
  });
  const fields: [string, string | null, string][] = [
    ['title', release.title, 'The release has no title.'],
    ['type', release.type, 'The release has no type.'],
    ['primary_artist', release.primaryArtist, 'The release has no primary artist.'],
    ['label_name', release.labelName, 'The label name is missing.'],
    ['p_line', release.pLine, 'The ℗ line is missing.'],
    ['c_line', release.cLine, 'The © line is missing.'],
    ['primary_genre', release.primaryGenre, 'The genre is missing.'],
    ['upc', release.upc, 'The UPC is missing.'],
  ];
  for (const [code, value, message] of fields) if (blank(value)) mdb.push(md(code, message));
  if (blank(release.targetDate) && blank(release.releaseDate)) mdb.push(md('date', 'Neither a target nor a release date is set.'));
  for (const i of ordered) if (blank(i.isrc)) mdb.push(md('isrc', `${at(i)} has no ISRC.`, i));
  const metadata = approvalGate('metadata', 'metadata', facts.approvals.metadata, mdb, []);

  // marketing
  const marketing = settings.marketing_gate === 'off' ? gateState('not_required') : approvalGate('marketing', 'marketing', facts.approvals.marketing, [], []);

  const gates: Record<ReleaseGate, GateState> = { tracklist, masters, credits_splits, legal, artwork, metadata, marketing };

  if (release.state === 'cancelled') {
    // Not going out: nothing is required of it.
    const off = Object.fromEntries(RELEASE_GATES.map((g) => [g, gateState('not_required')])) as Record<ReleaseGate, GateState>;
    return { releaseState: release.state, gates: off, readyToDeliver: false };
  }

  const ready = release.state === 'draft' && RELEASE_GATES.every((g) => GATE_SATISFIED.includes(gates[g].status));
  return { releaseState: release.state, gates, readyToDeliver: ready };
}

// ── What a caller may be told ───────────────────────────────────────────

export type GateView = {
  status: GateStatus;
  blockerCount: number;
  warningCount: number;
  /** Blockers the caller may read; sensitive ones appear only with `rights.read`. */
  blockers: { code: string; message: string; fixCapability: Capability; itemId: string | null; songId: string | null }[];
  warnings: { code: string; message: string; fixCapability: Capability; itemId: string | null; songId: string | null }[];
  /** Blockers and warnings counted but not listed (they would name rights data). */
  withheld: number;
  approval: ApprovalState | null;
};

export type ReleaseReadinessView = {
  releaseState: string;
  readyToDeliver: boolean;
  gates: Record<ReleaseGate, GateView>;
};

/** Field by field: a new property of a blocker is never sent until it is named here. */
export function releaseReadinessView(r: ReleaseReadiness, mayReadRights: boolean): ReleaseReadinessView {
  const pick = (b: ReadinessBlocker) => ({ code: b.code, message: b.message, fixCapability: b.fixCapability, itemId: b.itemId ?? null, songId: b.songId ?? null });
  const gates = {} as Record<ReleaseGate, GateView>;
  for (const g of RELEASE_GATES) {
    const s = r.gates[g];
    const visible = (list: ReadinessBlocker[]) => list.filter((b) => mayReadRights || !b.sensitive);
    const blockers = visible(s.blockers);
    const warnings = visible(s.warnings);
    gates[g] = {
      status: s.status,
      blockerCount: s.blockers.length,
      warningCount: s.warnings.length,
      blockers: blockers.map(pick),
      warnings: warnings.map(pick),
      withheld: s.blockers.length - blockers.length + (s.warnings.length - warnings.length),
      approval: s.approval ? { gate: s.approval.gate, status: s.approval.status, stale: s.approval.stale, requestedAt: s.approval.requestedAt, decidedAt: s.approval.decidedAt } : null,
    };
  }
  return { releaseState: r.releaseState, readyToDeliver: r.readyToDeliver, gates };
}
