/**
 * Structured relational filters over an org's songs and releases (LABEL-37,
 * 08 §A2/§A3). Pure: a typed, versioned DEFINITION, a parser/validator, the
 * evaluators the routes run over facts they have already scope- and
 * D4-filtered, and the applied-filter chips the UI draws. No database, no
 * clock, no I/O — `filters-store.ts` reads, this module decides.
 *
 * A definition stores only IDS and enums (never names, never results), is
 * versioned, and is size-capped. Names are resolved per VIEWER by the route
 * (`sanitizeDefinition` drops ids the viewer may not see before the
 * definition is handed back), and results are recomputed per viewer on every
 * run: the same view run by an unscoped owner and by a member limited to one
 * artist returns different rows, never the owner's.
 *
 * The seven 08 §A2 example queries are `EXAMPLE_QUERIES` below, each a plain
 * definition; `filters.test.ts` runs every one against a fixture catalogue.
 */
import { z } from 'zod';
import { CREDIT_STATUSES, creditRoleLabel, isCreditRole, type CreditStatus } from './credit-roles';
import { RECORDING_KINDS } from './capabilities';
import { SONG_STAGES, SONG_STAGE_LABEL, type SongStage } from './song-stage';
import { RELEASE_GATES, type GateStatus, type ReleaseGate } from './release-readiness';
import { RELEASE_STATES, RELEASE_TYPES } from './releases';
import type { BoardRelease } from './release-board';

export const FILTER_VERSION = 1;
export const SUBJECTS = ['songs', 'releases'] as const;
export type Subject = (typeof SUBJECTS)[number];

/** A serialised definition may not exceed this; a saved view that big is a bug or an attack. */
export const MAX_DEFINITION_BYTES = 4000;
const MAX_IDS = 25;
const MAX_CLAUSES = 5;
const MAX_TEXT = 80;

export const PRODUCER_ROLES = ['producer', 'co_producer', 'executive_producer'] as const;
export const FEATURE_ROLES = ['feature'] as const;
export const MISSING_FIELDS = ['artwork', 'isrc', 'credits', 'bpm', 'key'] as const;
export type MissingField = (typeof MISSING_FIELDS)[number];
export const LEGAL_APPROVALS = ['none', 'waiting', 'approved', 'changes_requested'] as const;
export type LegalApproval = (typeof LEGAL_APPROVALS)[number];
export const SPLIT_STATES = ['incomplete', 'complete'] as const;
export type SplitState = (typeof SPLIT_STATES)[number];
export const GATE_STATUSES = ['not_started', 'blocked', 'awaiting_approval', 'approved', 'satisfied', 'not_required', 'stale'] as const satisfies readonly GateStatus[];

// ── The model ───────────────────────────────────────────────────────────

const uuid = z.string().uuid().transform((s) => s.toLowerCase());
const ids = z.array(uuid).max(MAX_IDS).transform((l) => [...new Set(l)]);
/** `YYYY-MM-DD`, a real calendar day. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
const text = z.string().trim().min(1).max(MAX_TEXT);
const oneOf = <T extends string>(values: readonly T[]) => z.enum(values as unknown as [T, ...T[]]);
const set = <T extends string>(values: readonly T[]) => z.array(oneOf(values)).max(values.length).transform((l) => [...new Set(l)] as T[]);

const CreditClause = z.object({
  partyId: uuid.optional(),
  roles: z.array(z.string().refine(isCreditRole)).max(12).transform((l) => [...new Set(l)]).optional(),
  status: z.array(oneOf(CREDIT_STATUSES)).max(3).optional(),
});
export type CreditClause = z.infer<typeof CreditClause>;

const RecordingClause = z.object({ kind: oneOf(RECORDING_KINDS), from: day.optional(), to: day.optional() });
export type RecordingClause = z.infer<typeof RecordingClause>;

export const SongFilterSchema = z.object({
  text: text.optional(),
  stages: set(SONG_STAGES).optional(),
  artistIds: ids.optional(),
  projectIds: ids.optional(),
  createdFrom: day.optional(),
  createdTo: day.optional(),
  recording: RecordingClause.optional(),
  credits: z.array(CreditClause).max(MAX_CLAUSES).optional(),
  involves: uuid.optional(),
  released: z.boolean().optional(),
  missing: set(MISSING_FIELDS).optional(),
  legalApproval: oneOf(LEGAL_APPROVALS).optional(),
  splits: oneOf(SPLIT_STATES).optional(),
  bpmMin: z.number().int().min(1).max(400).optional(),
  bpmMax: z.number().int().min(1).max(400).optional(),
  key: text.optional(),
});
export type SongFilter = z.infer<typeof SongFilterSchema>;

const GateClause = z.object({ gate: oneOf(RELEASE_GATES), status: z.array(oneOf(GATE_STATUSES)).min(1).max(GATE_STATUSES.length).transform((l) => [...new Set(l)]) });
export type GateClause = z.infer<typeof GateClause>;

export const ReleaseFilterSchema = z.object({
  text: text.optional(),
  states: set(RELEASE_STATES).optional(),
  types: set(RELEASE_TYPES).optional(),
  artistIds: ids.optional(),
  targetFrom: day.optional(),
  targetTo: day.optional(),
  releaseFrom: day.optional(),
  releaseTo: day.optional(),
  deliveredFrom: day.optional(),
  deliveredTo: day.optional(),
  gates: z.array(GateClause).max(RELEASE_GATES.length).optional(),
  ready: z.boolean().optional(),
});
export type ReleaseFilter = z.infer<typeof ReleaseFilterSchema>;

export type Definition =
  | { v: typeof FILTER_VERSION; subject: 'songs'; filter: SongFilter }
  | { v: typeof FILTER_VERSION; subject: 'releases'; filter: ReleaseFilter };

export type ParseResult = { ok: true; definition: Definition } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

/** Drops keys whose value is empty, so `{ stages: [] }` and `{}` are the same definition. */
function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

/**
 * Validate an untrusted definition (a saved view's JSON, a URL parameter).
 * Unknown keys are dropped, malformed values are an error — never silently
 * ignored, because dropping a restriction would WIDEN a saved view.
 */
export function parseDefinition(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('A view definition is an object');
  const o = raw as Record<string, unknown>;
  if (o.v !== FILTER_VERSION) return fail('Unknown view definition version');
  if (o.subject !== 'songs' && o.subject !== 'releases') return fail('A view is about songs or releases');
  let size = 0;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return fail('A view definition must be JSON');
  }
  if (size > MAX_DEFINITION_BYTES) return fail('This view is too large');
  const schema = o.subject === 'songs' ? SongFilterSchema : ReleaseFilterSchema;
  const parsed = schema.safeParse(o.filter ?? {});
  if (!parsed.success) return fail('A filter in this view is not valid');
  const filter = compact(parsed.data as Record<string, unknown>);
  // A range that runs backwards matches nothing; say so instead of saving it.
  const bad = reversedRange(o.subject, filter);
  if (bad) return fail(bad);
  return { ok: true, definition: { v: FILTER_VERSION, subject: o.subject, filter } as Definition };
}

function reversedRange(subject: Subject, f: Record<string, unknown>): string | null {
  const pairs: [string, string, string][] =
    subject === 'songs'
      ? [['createdFrom', 'createdTo', 'The created range ends before it starts'], ['bpmMin', 'bpmMax', 'The tempo range ends before it starts']]
      : [
          ['targetFrom', 'targetTo', 'The target date range ends before it starts'],
          ['releaseFrom', 'releaseTo', 'The release date range ends before it starts'],
          ['deliveredFrom', 'deliveredTo', 'The delivered range ends before it starts'],
        ];
  for (const [a, b, msg] of pairs) if (f[a] !== undefined && f[b] !== undefined && (f[a] as string | number) > (f[b] as string | number)) return msg;
  const rec = f.recording as RecordingClause | undefined;
  if (rec?.from && rec.to && rec.from > rec.to) return 'The recording range ends before it starts';
  return null;
}

export const emptyDefinition = (subject: Subject): Definition => ({ v: FILTER_VERSION, subject, filter: {} }) as Definition;

/** True when the definition restricts nothing. */
export function isEmptyFilter(def: Definition): boolean {
  return Object.keys(def.filter).length === 0;
}

// ── URL form ────────────────────────────────────────────────────────────

/** A definition as a URL-safe string (the `f` parameter of the Music and Releases pages). */
export function encodeDefinition(def: Definition): string {
  let bin = '';
  for (const b of new TextEncoder().encode(JSON.stringify(def))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeDefinition(param: string | null | undefined): ParseResult {
  if (!param) return fail('No filter');
  if (param.length > MAX_DEFINITION_BYTES * 2) return fail('This filter is too large');
  try {
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return parseDefinition(JSON.parse(json));
  } catch {
    return fail('This filter could not be read');
  }
}

// ── What a definition needs ─────────────────────────────────────────────

/** The extra facts a song filter needs beyond the base row (artist, project, stage, dates, cover, tempo). */
export type SongNeed = 'recordings' | 'credits' | 'involved' | 'legal_approval' | 'splits';

export function songNeeds(f: SongFilter): Set<SongNeed> {
  const needs = new Set<SongNeed>();
  if (f.recording) needs.add('recordings');
  if (f.credits?.length || f.missing?.includes('credits')) needs.add('credits');
  if (f.involves) needs.add('involved');
  if (f.legalApproval) needs.add('legal_approval');
  if (f.splits) needs.add('splits');
  return needs;
}

/**
 * The capabilities a definition asks for beyond `catalog.read`. A viewer who
 * lacks one gets NO rows and the list of what they cannot use — never the
 * rest of the view without the clause, which would widen it, and never an
 * answer that lets them infer who is credited or what a legal note says.
 */
export type Dimension = 'credits' | 'involved' | 'splits' | 'legal_approval';
export const DIMENSION_LABEL: Record<Dimension, string> = {
  credits: 'credits',
  involved: 'involvement',
  splits: 'splits',
  legal_approval: 'legal approvals',
};

export function dimensionsOf(def: Definition): Dimension[] {
  if (def.subject !== 'songs') return [];
  const f = def.filter;
  const out: Dimension[] = [];
  if (f.credits?.length || f.missing?.includes('credits')) out.push('credits');
  if (f.involves) out.push('involved');
  if (f.splits) out.push('splits');
  if (f.legalApproval) out.push('legal_approval');
  return out;
}

/** The dimensions of `def` the capability set cannot use. `readApprovals` is `mayReadApprovals(caps)`. */
export function unavailableDimensions(def: Definition, caps: ReadonlySet<string>, readApprovals: boolean): Dimension[] {
  return dimensionsOf(def).filter((d) => (d === 'legal_approval' ? !readApprovals : !caps.has('rights.read')));
}

// ── Songs ───────────────────────────────────────────────────────────────

export type SongFacts = {
  id: string;
  title: string | null;
  stage: SongStage | string | null;
  createdAt: string;
  coverUrl: string | null;
  bpm: number | null;
  key: string | null;
  isrc: string | null;
  artistIds: string[];
  projectIds: string[];
  released: boolean;
  /** Recordings the VIEWER may see (D4 already applied by the store), each with its creation time. */
  recordings?: { kind: string; createdAt: string }[];
  credits?: { partyId: string | null; role: string; status: string }[];
  /** Parties the song involves: credited, on a split line, or whose account uploaded it, was assigned its tasks, or is a member of its project. */
  involvedPartyIds?: string[];
  legalApproval?: LegalApproval;
  splitsComplete?: boolean;
};

const inRange = (value: string, from?: string, to?: string): boolean => (!from || value >= from) && (!to || value <= to);
const dayOf = (iso: string): string => iso.slice(0, 10);
const norm = (s: string): string => s.trim().toLowerCase();
const sameKey = (a: string, b: string): boolean => norm(a).replace(/\s+/g, '') === norm(b).replace(/\s+/g, '');

/** The cheap predicates, decidable from a base row — the store applies these first and loads the rest only for what survives. */
export function matchSongBase(f: SongFilter, s: SongFacts): boolean {
  if (f.text && !norm(s.title ?? '').includes(norm(f.text))) return false;
  if (f.stages?.length && !f.stages.includes(s.stage as SongStage)) return false;
  if (f.artistIds?.length && !s.artistIds.some((a) => f.artistIds!.includes(a))) return false;
  if (f.projectIds?.length && !s.projectIds.some((p) => f.projectIds!.includes(p))) return false;
  if ((f.createdFrom || f.createdTo) && !inRange(dayOf(s.createdAt), f.createdFrom, f.createdTo)) return false;
  if (f.released !== undefined && s.released !== f.released) return false;
  if (f.bpmMin !== undefined && !(s.bpm !== null && s.bpm >= f.bpmMin)) return false;
  if (f.bpmMax !== undefined && !(s.bpm !== null && s.bpm <= f.bpmMax)) return false;
  if (f.key && !(s.key && sameKey(s.key, f.key))) return false;
  for (const m of f.missing ?? []) {
    if (m === 'artwork' && s.coverUrl) return false;
    if (m === 'isrc' && s.isrc) return false;
    if (m === 'bpm' && s.bpm !== null) return false;
    if (m === 'key' && s.key) return false;
  }
  return true;
}

/** True when `credit` satisfies one clause. A clause with no party and no role matches any credit. */
function creditMatches(c: NonNullable<SongFacts['credits']>[number], clause: CreditClause): boolean {
  if (clause.partyId && c.partyId !== clause.partyId) return false;
  if (clause.roles?.length && !clause.roles.includes(c.role)) return false;
  if (clause.status?.length && !clause.status.includes(c.status as CreditStatus)) return false;
  return true;
}

/**
 * The whole predicate. A fact the filter needs but the store did not load is
 * a NO — failing closed, so a missing enrichment can never widen a result.
 */
export function matchSong(f: SongFilter, s: SongFacts): boolean {
  if (!matchSongBase(f, s)) return false;
  if (f.recording) {
    if (!s.recordings) return false;
    const r = f.recording;
    if (!s.recordings.some((x) => x.kind === r.kind && inRange(dayOf(x.createdAt), r.from, r.to))) return false;
  }
  if (f.credits?.length || f.missing?.includes('credits')) {
    if (!s.credits) return false;
    for (const clause of f.credits ?? []) if (!s.credits.some((c) => creditMatches(c, clause))) return false;
    if (f.missing?.includes('credits') && s.credits.length > 0) return false;
  }
  if (f.involves) {
    if (!s.involvedPartyIds?.includes(f.involves)) return false;
  }
  if (f.legalApproval) {
    if (s.legalApproval === undefined || s.legalApproval !== f.legalApproval) return false;
  }
  if (f.splits) {
    if (s.splitsComplete === undefined) return false;
    if ((f.splits === 'complete') !== s.splitsComplete) return false;
  }
  return true;
}

/**
 * The parties a song involves (08 §A2, "everything involving Producer X"):
 * credited, named on a split line, or — through the account behind the
 * party — the uploader, a task assignee or a member of the song's project.
 */
export function involvedParties(input: {
  credits: readonly { partyId: string | null }[];
  splitPartyIds: readonly string[];
  accountUserIds: readonly string[];
  /** party id → the account (user) behind it, for the parties that have one */
  partyUsers: ReadonlyMap<string, string>;
}): string[] {
  const out = new Set<string>();
  for (const c of input.credits) if (c.partyId) out.add(c.partyId);
  for (const p of input.splitPartyIds) out.add(p);
  const users = new Set(input.accountUserIds.map((u) => u.toLowerCase()));
  for (const [party, user] of input.partyUsers) if (users.has(user.toLowerCase())) out.add(party);
  return [...out];
}

/** Newest first, id as the tiebreak — the order every list of songs uses. */
export function sortSongs<T extends { id: string; createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

// ── Releases ────────────────────────────────────────────────────────────

/** What a release predicate reads. A board row has all of it; a bare release row has no gates. */
export type ReleaseFacts = Pick<BoardRelease, 'title' | 'type' | 'state' | 'artistId' | 'targetDate' | 'releaseDate' | 'deliveredAt'>;

/** The predicates decidable from the release row alone — applied before any gate is evaluated. */
export function matchReleaseBase(f: ReleaseFilter, r: ReleaseFacts): boolean {
  if (f.text && !norm(r.title).includes(norm(f.text))) return false;
  if (f.states?.length && !f.states.includes(r.state as (typeof RELEASE_STATES)[number])) return false;
  if (f.types?.length && !f.types.includes(r.type as (typeof RELEASE_TYPES)[number])) return false;
  if (f.artistIds?.length && !f.artistIds.includes(r.artistId.toLowerCase())) return false;
  if ((f.targetFrom || f.targetTo) && !(r.targetDate && inRange(r.targetDate, f.targetFrom, f.targetTo))) return false;
  if ((f.releaseFrom || f.releaseTo) && !(r.releaseDate && inRange(r.releaseDate, f.releaseFrom, f.releaseTo))) return false;
  if ((f.deliveredFrom || f.deliveredTo) && !(r.deliveredAt && inRange(dayOf(r.deliveredAt), f.deliveredFrom, f.deliveredTo))) return false;
  return true;
}

/** True when the filter has a clause that needs the gates evaluated. */
export const releaseNeedsGates = (f: ReleaseFilter): boolean => !!f.gates?.length || f.ready !== undefined;

/** The release predicate over a board row (already scope-filtered; gates carry statuses, never blocker text). */
export function matchRelease(f: ReleaseFilter, r: BoardRelease): boolean {
  if (!matchReleaseBase(f, r)) return false;
  if (f.ready !== undefined && r.readyToDeliver !== f.ready) return false;
  // A delivered or cancelled release carries no gates (nothing is left to gate): a gate clause cannot hold for it.
  for (const clause of f.gates ?? []) {
    const g = r.gates.find((x) => x.gate === clause.gate);
    if (!g || !clause.status.includes(g.status)) return false;
  }
  return true;
}

export function filterReleases(rows: readonly BoardRelease[], f: ReleaseFilter): BoardRelease[] {
  return rows.filter((r) => matchRelease(f, r));
}

// ── Chips ───────────────────────────────────────────────────────────────

/** What a viewer's names resolve to. An id missing here is one the viewer may not see: it draws no chip. */
export type NameLookup = {
  artists: ReadonlyMap<string, string>;
  parties: ReadonlyMap<string, string>;
  projects: ReadonlyMap<string, string>;
};
export const NO_NAMES: NameLookup = { artists: new Map(), parties: new Map(), projects: new Map() };

export type Chip = { key: string; label: string };

const GATE_LABEL: Record<ReleaseGate, string> = {
  tracklist: 'Tracklist',
  masters: 'Masters',
  credits_splits: 'Credits & splits',
  legal: 'Legal',
  artwork: 'Artwork',
  metadata: 'Metadata',
  marketing: 'Marketing',
};
const STATUS_LABEL: Record<GateStatus, string> = {
  not_started: 'not started',
  blocked: 'blocked',
  awaiting_approval: 'awaiting approval',
  approved: 'approved',
  satisfied: 'satisfied',
  not_required: 'not required',
  stale: 'stale',
};
const MISSING_LABEL: Record<MissingField, string> = { artwork: 'artwork', isrc: 'ISRC', credits: 'credits', bpm: 'tempo', key: 'key' };
const LEGAL_LABEL: Record<LegalApproval, string> = {
  none: 'Legal: not asked',
  waiting: 'Legal: waiting',
  approved: 'Legal: approved',
  changes_requested: 'Legal: changes requested',
};
const RECORDING_LABEL: Record<string, string> = { beat_source: 'beat', demo: 'demo', rough: 'rough', topline: 'topline', loop: 'loop', mix: 'mix', master: 'master', instrumental: 'instrumental', acapella: 'acapella', clean: 'clean', reference: 'reference' };

const range = (a?: string, b?: string) => (a && b ? `${a} – ${b}` : a ? `from ${a}` : `to ${b}`);

/** An id the viewer may not see draws nothing. */
function named(map: ReadonlyMap<string, string>, id: string): string | null {
  return map.get(id) ?? null;
}

function creditLabel(c: CreditClause, names: NameLookup): string | null {
  const who = c.partyId ? named(names.parties, c.partyId) : 'Anyone';
  if (who === null) return null;
  const roles = c.roles?.length ? c.roles.map(creditRoleLabel).join(' / ') : 'credited';
  return `${who} · ${roles}`;
}

/** The applied-filter chips for a definition, in a stable order. */
export function describeFilter(def: Definition, names: NameLookup = NO_NAMES): Chip[] {
  const chips: Chip[] = [];
  const push = (key: string, label: string | null) => {
    if (label) chips.push({ key, label });
  };
  if (def.subject === 'songs') {
    const f = def.filter;
    push('text', f.text ? `Title: “${f.text}”` : null);
    for (const s of f.stages ?? []) push(`stage:${s}`, `Stage: ${SONG_STAGE_LABEL[s]}`);
    for (const id of f.artistIds ?? []) push(`artist:${id}`, named(names.artists, id));
    for (const id of f.projectIds ?? []) push(`project:${id}`, named(names.projects, id) && `Project: ${named(names.projects, id)}`);
    push('created', f.createdFrom || f.createdTo ? `Created ${range(f.createdFrom, f.createdTo)}` : null);
    if (f.recording) {
      const k = RECORDING_LABEL[f.recording.kind] ?? f.recording.kind;
      push('recording', `Has ${k}${f.recording.from || f.recording.to ? ` ${range(f.recording.from, f.recording.to)}` : ''}`);
    }
    (f.credits ?? []).forEach((c, i) => push(`credit:${i}`, creditLabel(c, names)));
    push('involves', f.involves ? named(names.parties, f.involves) && `Involving ${named(names.parties, f.involves)}` : null);
    if (f.released !== undefined) push('released', f.released ? 'Released' : 'Unreleased');
    for (const m of f.missing ?? []) push(`missing:${m}`, `Missing ${MISSING_LABEL[m]}`);
    if (f.legalApproval) push('legal', LEGAL_LABEL[f.legalApproval]);
    if (f.splits) push('splits', f.splits === 'incomplete' ? 'Splits incomplete' : 'Splits complete');
    if (f.bpmMin !== undefined || f.bpmMax !== undefined) push('bpm', `Tempo ${f.bpmMin !== undefined && f.bpmMax !== undefined ? `${f.bpmMin}–${f.bpmMax}` : f.bpmMin !== undefined ? `≥ ${f.bpmMin}` : `≤ ${f.bpmMax}`}`);
    if (f.key) push('key', `Key: ${f.key}`);
  } else {
    const f = def.filter;
    push('text', f.text ? `Title: “${f.text}”` : null);
    for (const s of f.states ?? []) push(`state:${s}`, `State: ${s}`);
    for (const t of f.types ?? []) push(`type:${t}`, `Type: ${t}`);
    for (const id of f.artistIds ?? []) push(`artist:${id}`, named(names.artists, id));
    push('target', f.targetFrom || f.targetTo ? `Target ${range(f.targetFrom, f.targetTo)}` : null);
    push('release', f.releaseFrom || f.releaseTo ? `Release date ${range(f.releaseFrom, f.releaseTo)}` : null);
    push('delivered', f.deliveredFrom || f.deliveredTo ? `Delivered ${range(f.deliveredFrom, f.deliveredTo)}` : null);
    if (f.ready !== undefined) push('ready', f.ready ? 'Ready to deliver' : 'Not ready');
    for (const g of f.gates ?? []) push(`gate:${g.gate}`, `${GATE_LABEL[g.gate]}: ${g.status.map((s) => STATUS_LABEL[s]).join(' / ')}`);
  }
  return chips;
}

/** The definition without the filter a chip stands for. A key that names nothing returns the definition unchanged. */
export function removeChip(def: Definition, key: string): Definition {
  const [kind, rest] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)];
  const next = { ...def.filter } as Record<string, unknown>;
  const drop = (name: string, value?: string) => {
    const cur = next[name];
    if (Array.isArray(cur) && value !== undefined) next[name] = cur.filter((x) => x !== value);
    else delete next[name];
  };
  switch (kind) {
    case 'text': drop('text'); break;
    case 'stage': drop('stages', rest); break;
    case 'state': drop('states', rest); break;
    case 'type': drop('types', rest); break;
    case 'artist': drop('artistIds', rest); break;
    case 'project': drop('projectIds', rest); break;
    case 'created': drop('createdFrom'); drop('createdTo'); break;
    case 'recording': drop('recording'); break;
    case 'credit': {
      const list = (next.credits as CreditClause[] | undefined) ?? [];
      next.credits = list.filter((_, i) => String(i) !== rest);
      break;
    }
    case 'involves': drop('involves'); break;
    case 'released': drop('released'); break;
    case 'missing': drop('missing', rest); break;
    case 'legal': drop('legalApproval'); break;
    case 'splits': drop('splits'); break;
    case 'bpm': drop('bpmMin'); drop('bpmMax'); break;
    case 'key': drop('key'); break;
    case 'target': drop('targetFrom'); drop('targetTo'); break;
    case 'release': drop('releaseFrom'); drop('releaseTo'); break;
    case 'delivered': drop('deliveredFrom'); drop('deliveredTo'); break;
    case 'ready': drop('ready'); break;
    case 'gate': next.gates = ((next.gates as GateClause[] | undefined) ?? []).filter((g) => g.gate !== rest); break;
    default: return def;
  }
  return { ...def, filter: compact(next) } as Definition;
}

// ── Per viewer ──────────────────────────────────────────────────────────

/** What a viewer may see of a definition's ids. */
export type VisibleIds = {
  /** `null` = every id (an unscoped viewer); a set = exactly those. */
  artists: ReadonlySet<string> | null;
  parties: ReadonlySet<string> | null;
  projects: ReadonlySet<string> | null;
};

/**
 * The definition as one viewer may be shown it: ids they cannot see are
 * dropped, so a view shared by an unscoped owner never names an artist,
 * party or project outside a scoped member's reach. `narrowed` says only that
 * something was dropped — never what, never how many.
 *
 * This is for DISPLAY (chips, the editor). Running a view uses the original:
 * rows are scope-filtered per viewer, so an id they cannot see matches
 * nothing of theirs, and dropping it would widen the result.
 */
export function sanitizeDefinition(def: Definition, visible: VisibleIds): { definition: Definition; narrowed: boolean } {
  let narrowed = false;
  const keep = (list: string[] | undefined, ok: ReadonlySet<string> | null): string[] | undefined => {
    if (!list || ok === null) return list;
    const kept = list.filter((id) => ok.has(id));
    if (kept.length !== list.length) narrowed = true;
    return kept;
  };
  const f = { ...def.filter } as Record<string, unknown>;
  if ('artistIds' in f) f.artistIds = keep(f.artistIds as string[] | undefined, visible.artists);
  if ('projectIds' in f) f.projectIds = keep(f.projectIds as string[] | undefined, visible.projects);
  if (typeof f.involves === 'string' && visible.parties !== null && !visible.parties.has(f.involves)) {
    delete f.involves;
    narrowed = true;
  }
  if (Array.isArray(f.credits)) {
    f.credits = (f.credits as CreditClause[]).map((c) => {
      if (c.partyId && visible.parties !== null && !visible.parties.has(c.partyId)) {
        narrowed = true;
        const rest = { ...c };
        delete rest.partyId;
        return rest;
      }
      return c;
    });
  }
  return { definition: { ...def, filter: compact(f) } as Definition, narrowed };
}

/** Every artist / party / project id a definition mentions, for the name lookup. */
export function mentionedIds(def: Definition): { artists: string[]; parties: string[]; projects: string[] } {
  const f = def.filter as Record<string, unknown>;
  const parties = new Set<string>();
  if (typeof f.involves === 'string') parties.add(f.involves);
  for (const c of (f.credits as CreditClause[] | undefined) ?? []) if (c.partyId) parties.add(c.partyId);
  return {
    artists: [...((f.artistIds as string[] | undefined) ?? [])],
    parties: [...parties],
    projects: [...((f.projectIds as string[] | undefined) ?? [])],
  };
}

// ── The seven 08 §A2 queries ────────────────────────────────────────────

/** Ids a caller fills in (`producer` and `featured` are PARTY ids, `artistA` a roster contact id); the shapes are what the acceptance tests run. */
export type ExampleIds = { producer: string; artistA: string; featured: string };

export function exampleQueries(ids: ExampleIds, year: number): { key: string; label: string; definition: Definition }[] {
  const songs = (filter: SongFilter): Definition => ({ v: FILTER_VERSION, subject: 'songs', filter });
  return [
    { key: 'produced-by', label: 'All songs produced by Producer X', definition: songs({ credits: [{ partyId: ids.producer, roles: [...PRODUCER_ROLES] }] }) },
    {
      key: 'demos-september',
      label: 'Artist A demos from September',
      definition: songs({ artistIds: [ids.artistA], recording: { kind: 'demo', from: `${year}-09-01`, to: `${year}-09-30` } }),
    },
    { key: 'missing-artwork', label: 'Songs missing artwork', definition: songs({ missing: ['artwork'] }) },
    { key: 'waiting-legal', label: 'Projects waiting for legal', definition: songs({ legalApproval: 'waiting' }) },
    { key: 'involving', label: 'Everything involving Producer X', definition: songs({ involves: ids.producer }) },
    {
      key: 'unreleased-featuring',
      label: 'Unreleased songs featuring Artist B',
      definition: songs({ released: false, credits: [{ partyId: ids.featured, roles: [...FEATURE_ROLES] }] }),
    },
    { key: 'splits-incomplete', label: 'Songs where splits aren’t complete', definition: songs({ splits: 'incomplete' }) },
  ];
}
