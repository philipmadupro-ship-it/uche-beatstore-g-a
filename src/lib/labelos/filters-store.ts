/**
 * The reads behind structured filters (LABEL-37). Called by
 * `GET /api/org/[orgId]/views/run` and the Music / Releases pages after
 * `requireOrgCapability('catalog.read')` authorised the member. The rules are
 * the pure `filters.ts`; this file only reads, and — exactly as LABEL-35's
 * Needs attention and LABEL-36's search do — applies the viewer's artist scope
 * and D4 BEFORE a row can be a result:
 *
 *  - SCOPE: a member limited to some artists (a roster artist, always) is
 *    filtered only inside the projects their scope reaches
 *    (`orgProjectIdsInScope`, 141's `can_see_org_project`); a song outside it
 *    is never loaded, so it can neither match nor be counted.
 *  - D4: `partitionSongs` over `orgTrackFacts` — a song whose row the viewer
 *    may not read is dropped without trace (no "N hidden" here; the Needs
 *    attention list may count them, a filter result does not). A RECORDING
 *    counts toward a `recording` clause only when the viewer holds the audio
 *    capability its kind calls for, so a marketing member's "demos" query
 *    cannot reveal that a song has one.
 *  - RIGHTS: clauses on credits, splits and involvement need `rights.read`,
 *    legal approvals the approval abilities (`unavailableDimensions`). Without
 *    them the answer is NO rows and the list of what was unavailable — never
 *    the rest of the view with the clause quietly dropped (that would widen
 *    it), and never an answer from which who is credited could be inferred.
 *
 * The cheap predicates (stage, artist, project, dates, cover, tempo, key,
 * released) run first on the base row; the facts the rest need — recordings,
 * credits, splits, approvals, who is involved — are loaded in chunks for the
 * survivors only, and only for the clauses the filter has.
 *
 * A source whose migration is not applied (credits 153, split sheets 155,
 * approvals 157, releases 144) contributes nothing, which fails closed: a
 * clause that needs it matches no song.
 */
import { orgProjectIdsInScope, type OrgAccessOk } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { audioCapabilityFor, type RecordingKind } from './capabilities';
import { currentDecision, APPROVAL_COLUMNS, type ApprovalRow } from './approvals';
import { mayReadApprovals } from './approvals-route';
import {
  matchReleaseBase,
  matchRelease,
  matchSong,
  matchSongBase,
  involvedParties,
  releaseNeedsGates,
  songNeeds,
  sortSongs,
  unavailableDimensions,
  type Definition,
  type Dimension,
  type ReleaseFilter,
  type SongFacts,
  type SongFilter,
  type VisibleIds,
} from './filters';
import { evaluateLegalReadiness, type ReadinessSheet } from './legal-readiness';
import { partitionSongs } from './org-workspace';
import { orgTrackFacts, projectArtists } from './org-workspace-store';
import { chunks, inChunks, pageAll, ReadError } from './overview-store';
import { recordingKindOf } from './recording-kind';
import { loadReleaseBoard } from './release-board-store';
import type { BoardRelease } from './release-board';
import { scopedPartyIds } from './credits-store';
import { isSplitKind } from './splits';
import type { LinkRelation } from '@/lib/tracks/links';

type Admin = OrgAccessOk['admin'];

/** Rows returned in one go; the rest are `more`. */
export const RUN_LIMIT = 100;
export const RUN_MAX_LIMIT = 200;

export type SongResultRow = {
  id: string;
  title: string | null;
  stage: string | null;
  coverUrl: string | null;
  bpm: number | null;
  key: string | null;
  createdAt: string;
  released: boolean;
  artist: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
};

export type SongRun = {
  kind: 'songs';
  rows: SongResultRow[];
  /** Songs the viewer may read that match — never a count that includes anything hidden. */
  total: number;
  more: boolean;
  /** Clauses the viewer's role cannot use; the rows are empty when this is not. */
  unavailable: Dimension[];
};

export type ReleaseRun = {
  kind: 'releases';
  rows: BoardRelease[];
  total: number;
  more: boolean;
  /** Matching releases past the most recent `BOARD_LIMIT`, which the board never evaluates (it says so; they are not paged). */
  olderNotShown: number;
  schemaReady: boolean;
};

export type RunResult = SongRun | ReleaseRun;

/** Reads that tolerate a table that does not exist yet: it contributes nothing. */
async function tolerant<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ReadError && isMissingSchema(err.raw)) return [];
    throw err;
  }
}

// ── Songs: the candidates ───────────────────────────────────────────────

type TrackRow = {
  id: string;
  title: string | null;
  type: string | null;
  song_stage: string | null;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  isrc: string | null;
  created_at: string;
  created_by: string | null;
};

const TRACK_COLUMNS = 'id, title, type, song_stage, cover_url, bpm, key, isrc, created_at, created_by';

/** Org songs inside the viewer's reach (`scoped` null = the whole org). */
async function songCandidates(admin: Admin, org: string, scoped: string[] | null): Promise<TrackRow[]> {
  if (scoped === null) {
    return pageAll<TrackRow>(
      (from, to) => admin.from('tracks').select(TRACK_COLUMNS).eq('org_id', org).eq('type', 'song').not('song_stage', 'is', null).order('id').range(from, to),
      'song read',
    );
  }
  if (scoped.length === 0) return [];
  const placed = await inChunks<{ project_id: string; track_id: string }>(
    scoped,
    (part, from, to) => admin.from('project_tracks').select('project_id, track_id').in('project_id', part).order('project_id').order('track_id').range(from, to),
    'song placement read',
  );
  return inChunks<TrackRow>(
    placed.map((p) => p.track_id),
    (part, from, to) => admin.from('tracks').select(TRACK_COLUMNS).in('id', part).eq('org_id', org).eq('type', 'song').not('song_stage', 'is', null).order('id').range(from, to),
    'song read',
  );
}

type Candidate = { row: TrackRow; facts: SongFacts; onRelease: boolean };

/** The viewer's songs as base facts: D4 applied, with their artists and projects (restricted to the viewer's scope). */
async function baseSongs(access: OrgAccessOk, scoped: string[] | null): Promise<Candidate[]> {
  const { admin, orgId: org } = access;
  const rows = await songCandidates(admin, org, scoped);
  if (rows.length === 0) return [];

  const facts = new Map<string, Awaited<ReturnType<typeof orgTrackFacts>> extends Map<string, infer V> ? V : never>();
  for (const part of await Promise.all(chunks(rows.map((r) => r.id)).map((ids) => orgTrackFacts(admin, org, ids)))) {
    for (const [id, f] of part) facts.set(id, f);
  }
  const { visible } = partitionSongs(rows, facts, access.capabilities);
  if (visible.length === 0) return [];

  const placements = await inChunks<{ project_id: string; track_id: string }>(
    visible.map((r) => r.id),
    (part, from, to) => admin.from('project_tracks').select('project_id, track_id').in('track_id', part).order('project_id').order('track_id').range(from, to),
    'song placement read',
  );
  const reach = scoped === null ? null : new Set(scoped);
  const inReach = placements.filter((p) => reach === null || reach.has(p.project_id));
  const projects = await inChunks<{ id: string; inbox_for_contact_id: string | null }>(
    [...new Set(inReach.map((p) => p.project_id))],
    (part, from, to) => admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', org).in('id', part).order('id').range(from, to),
    'project read',
  );
  const artistsOf = new Map<string, string[]>();
  for (const part of await Promise.all(chunks(projects).map((p) => projectArtists(admin, p)))) for (const [k, v] of part) artistsOf.set(k, v);
  const known = new Set(projects.map((p) => p.id));
  const scopeArtists = access.artistScope === null ? null : new Set([...access.artistScope].map((a) => a.toLowerCase()));

  const projectsOf = new Map<string, string[]>();
  for (const p of inReach) {
    if (!known.has(p.project_id)) continue; // a placement into a project of another org is not followed
    projectsOf.set(p.track_id, [...(projectsOf.get(p.track_id) ?? []), p.project_id]);
  }

  return visible.map((row): Candidate => {
    const projectIds = [...new Set(projectsOf.get(row.id) ?? [])];
    // A scoped viewer is told only of artists they can see.
    const artistIds = [...new Set(projectIds.flatMap((p) => artistsOf.get(p) ?? []).map((a) => a.toLowerCase()))].filter((a) => scopeArtists === null || scopeArtists.has(a));
    const f = facts.get(row.id);
    const onRelease = !!f?.on_release;
    return {
      row,
      onRelease,
      facts: {
        id: row.id,
        title: row.title,
        stage: row.song_stage,
        createdAt: row.created_at,
        coverUrl: row.cover_url,
        bpm: row.bpm,
        key: row.key,
        isrc: row.isrc,
        artistIds,
        projectIds: projectIds.map((p) => p.toLowerCase()),
        released: onRelease,
      },
    };
  });
}

// ── Songs: the enrichers (survivors only) ───────────────────────────────

type CreditRow = { track_id: string; party_id: string | null; role: string; status: string; scope: string | null; name: string | null; id: string };

async function loadCredits(admin: Admin, org: string, ids: readonly string[]): Promise<CreditRow[]> {
  return tolerant(() =>
    inChunks<CreditRow>(ids, (part, from, to) => admin.from('track_collaborators').select('id, track_id, party_id, role, status, scope, name').eq('org_id', org).in('track_id', part).order('id').range(from, to), 'credit read'),
  );
}

type SheetRow = { id: string; track_id: string; kind: string; version: number; status: string };
type LineRow = { id: string; split_sheet_id: string; party_id: string; role: string; share: number | string; signed_at: string | null };

async function loadSheets(admin: Admin, org: string, ids: readonly string[]): Promise<{ sheets: SheetRow[]; lines: LineRow[] }> {
  const sheets = await tolerant(() =>
    inChunks<SheetRow>(ids, (part, from, to) => admin.from('split_sheets').select('id, track_id, kind, version, status').eq('org_id', org).in('track_id', part).order('id').range(from, to), 'split sheet read'),
  );
  const lines = await tolerant(() =>
    inChunks<LineRow>(sheets.map((s) => s.id), (part, from, to) => admin.from('split_lines').select('id, split_sheet_id, party_id, role, share, signed_at').eq('org_id', org).in('split_sheet_id', part).order('id').range(from, to), 'split line read'),
  );
  return { sheets, lines };
}

/** `splits complete` = neither the composition split (L6) nor, on a release, the master split (L10) is open — the legal-readiness rule itself. */
export function splitsAreComplete(input: {
  credits: readonly { id: string; role: string; scope: string | null; status: string; party_id: string | null; name: string | null }[];
  sheets: readonly ReadinessSheet[];
  onRelease: boolean;
}): boolean {
  const readiness = evaluateLegalReadiness({
    title: null,
    credits: input.credits.map((c) => ({ id: c.id, role: c.role, scope: c.scope === 'composition' || c.scope === 'recording' ? c.scope : null, status: c.status, partyId: c.party_id, name: c.name ?? '' })),
    parties: [],
    sheets: input.sheets,
    onRelease: input.onRelease,
    samples: 'unknown',
    sampleClearance: false,
    requireSignedMasterSplit: false,
    isrc: null,
  });
  return !readiness.requirements.some((r) => (r.code === 'L6' || r.code === 'L10') && r.applicable && !r.satisfied);
}

async function loadRecordings(access: OrgAccessOk, songs: readonly Candidate[]): Promise<Map<string, { kind: string; createdAt: string }[]>> {
  const { admin, orgId: org } = access;
  const ids = songs.map((s) => s.row.id);
  const [links, beats] = await Promise.all([
    tolerant(() => inChunks<{ from_track_id: string; to_track_id: string; relation: string }>(ids, (part, from, to) => admin.from('track_links').select('from_track_id, to_track_id, relation').in('from_track_id', part).order('from_track_id').order('to_track_id').range(from, to), 'link read')),
    tolerant(() => inChunks<{ song_track_id: string; beat_track_id: string }>(ids, (part, from, to) => admin.from('song_beats').select('song_track_id, beat_track_id').in('song_track_id', part).order('song_track_id').order('beat_track_id').range(from, to), 'beat read')),
  ]);
  const targets = await inChunks<{ id: string; type: string | null; created_at: string }>(
    [...links.map((l) => l.to_track_id), ...beats.map((b) => b.beat_track_id)],
    (part, from, to) => admin.from('tracks').select('id, type, created_at').eq('org_id', org).in('id', part).order('id').range(from, to),
    'recording read',
  );
  const target = new Map(targets.map((t) => [t.id, t]));
  const out = new Map<string, { kind: string; createdAt: string }[]>();
  const caps = access.capabilities;
  const add = (song: string, kind: RecordingKind | null, createdAt: string, opts: { currentMixOfSelectedSong?: boolean } = {}) => {
    if (!kind) return;
    const need = audioCapabilityFor(kind, opts);
    if (!need || !caps.has(need)) return; // a recording the viewer could not hear is not one they can filter on
    out.set(song, [...(out.get(song) ?? []), { kind, createdAt }]);
  };
  for (const s of songs) add(s.row.id, 'mix', s.row.created_at, { currentMixOfSelectedSong: s.row.song_stage === 'selected' || s.onRelease });
  for (const l of links) {
    const t = target.get(l.to_track_id);
    if (t) add(l.from_track_id, recordingKindOf({ type: t.type }, l.relation as LinkRelation), t.created_at);
  }
  for (const b of beats) {
    const t = target.get(b.beat_track_id);
    if (t) add(b.song_track_id, recordingKindOf({ type: t.type }, 'beat'), t.created_at);
  }
  return out;
}

async function loadAccountUsers(access: OrgAccessOk, songs: readonly Candidate[]): Promise<{ bySong: Map<string, string[]>; partyUsers: Map<string, string> }> {
  const { admin, orgId: org } = access;
  const ids = songs.map((s) => s.row.id);
  const [tasks, links, parties] = await Promise.all([
    tolerant(() => inChunks<{ song_id: string; assignee_id: string | null; created_by: string | null }>(ids, (part, from, to) => admin.from('tasks').select('id, song_id, assignee_id, created_by').eq('org_id', org).in('song_id', part).order('id').range(from, to), 'task read')),
    tolerant(() => inChunks<{ from_track_id: string; to_track_id: string }>(ids, (part, from, to) => admin.from('track_links').select('from_track_id, to_track_id').in('from_track_id', part).order('from_track_id').order('to_track_id').range(from, to), 'link read')),
    tolerant(() => pageAll<{ id: string; user_id: string | null }>((from, to) => admin.from('parties').select('id, user_id').eq('org_id', org).not('user_id', 'is', null).order('id').range(from, to), 'party read')),
  ]);
  const recordings = await inChunks<{ id: string; created_by: string | null }>(
    links.map((l) => l.to_track_id),
    (part, from, to) => admin.from('tracks').select('id, created_by').eq('org_id', org).in('id', part).order('id').range(from, to),
    'recording read',
  );
  const uploader = new Map(recordings.map((r) => [r.id, r.created_by]));
  const projectIds = [...new Set(songs.flatMap((s) => s.facts.projectIds))];
  const now = Date.now();
  const members = await tolerant(() =>
    inChunks<{ project_id: string; user_id: string; expires_at: string | null }>(projectIds, (part, from, to) => admin.from('project_members').select('id, project_id, user_id, expires_at').eq('org_id', org).in('project_id', part).order('id').range(from, to), 'project member read'),
  );
  const bySong = new Map<string, string[]>();
  const push = (song: string, user: string | null | undefined) => {
    if (user) bySong.set(song, [...(bySong.get(song) ?? []), user.toLowerCase()]);
  };
  for (const s of songs) {
    push(s.row.id, s.row.created_by);
    for (const m of members) if (s.facts.projectIds.includes(m.project_id.toLowerCase()) && (!m.expires_at || Date.parse(m.expires_at) > now)) push(s.row.id, m.user_id);
  }
  for (const t of tasks) {
    push(t.song_id, t.assignee_id);
    push(t.song_id, t.created_by);
  }
  for (const l of links) push(l.from_track_id, uploader.get(l.to_track_id));
  const partyUsers = new Map(parties.filter((p) => p.user_id).map((p) => [p.id.toLowerCase(), p.user_id!.toLowerCase()]));
  return { bySong, partyUsers };
}

async function loadLegalApprovals(admin: Admin, org: string, ids: readonly string[]): Promise<Map<string, 'none' | 'waiting' | 'approved' | 'changes_requested'>> {
  const rows = await tolerant(() =>
    inChunks<ApprovalRow>(ids, (part, from, to) => admin.from('approvals').select(APPROVAL_COLUMNS).eq('org_id', org).eq('gate', 'legal').in('song_id', part).order('id').range(from, to), 'approval read'),
  );
  const bySong = new Map<string, ApprovalRow[]>();
  for (const r of rows) if (r.song_id) bySong.set(r.song_id, [...(bySong.get(r.song_id) ?? []), r]);
  const out = new Map<string, 'none' | 'waiting' | 'approved' | 'changes_requested'>();
  for (const id of ids) {
    const status = currentDecision(bySong.get(id) ?? []).status;
    out.set(id, status === 'requested' ? 'waiting' : status);
  }
  return out;
}

// ── Songs: the run ──────────────────────────────────────────────────────

/** A cap on the survivors whose derived facts are loaded at once; past it the filter must be narrowed. */
export class FilterTooBroadError extends Error {
  constructor() {
    super('This filter matches too many songs to check their rights data; narrow it first.');
  }
}
const DERIVED_CAP = 1500;

export async function runSongFilter(access: OrgAccessOk, filter: SongFilter, opts: { limit?: number; offset?: number } = {}): Promise<SongRun> {
  const def: Definition = { v: 1, subject: 'songs', filter };
  const unavailable = unavailableDimensions(def, access.capabilities, mayReadApprovals(access.capabilities));
  const limit = Math.min(Math.max(opts.limit ?? RUN_LIMIT, 1), RUN_MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);
  if (unavailable.length > 0) return { kind: 'songs', rows: [], total: 0, more: false, unavailable };

  const { admin, orgId: org } = access;
  const scoped = await orgProjectIdsInScope(admin, access);
  const base = (await baseSongs(access, scoped)).filter((c) => matchSongBase(filter, c.facts));
  const needs = songNeeds(filter);

  let matched: Candidate[] = base;
  if (needs.size > 0 && base.length > 0) {
    if (base.length > DERIVED_CAP) throw new FilterTooBroadError();
    const ids = base.map((c) => c.row.id);
    const [credits, sheetData, recordings, accounts, legal] = await Promise.all([
      needs.has('credits') || needs.has('involved') || needs.has('splits') ? loadCredits(admin, org, ids) : Promise.resolve([] as CreditRow[]),
      needs.has('involved') || needs.has('splits') ? loadSheets(admin, org, ids) : Promise.resolve({ sheets: [] as SheetRow[], lines: [] as LineRow[] }),
      needs.has('recordings') ? loadRecordings(access, base) : Promise.resolve(new Map<string, { kind: string; createdAt: string }[]>()),
      needs.has('involved') ? loadAccountUsers(access, base) : Promise.resolve({ bySong: new Map<string, string[]>(), partyUsers: new Map<string, string>() }),
      needs.has('legal_approval') ? loadLegalApprovals(admin, org, ids) : Promise.resolve(new Map<string, 'none' | 'waiting' | 'approved' | 'changes_requested'>()),
    ]);

    const creditsOf = new Map<string, CreditRow[]>();
    for (const c of credits) creditsOf.set(c.track_id, [...(creditsOf.get(c.track_id) ?? []), c]);
    const sheetsOf = new Map<string, SheetRow[]>();
    for (const s of sheetData.sheets) sheetsOf.set(s.track_id, [...(sheetsOf.get(s.track_id) ?? []), s]);
    const linesOf = new Map<string, LineRow[]>();
    for (const l of sheetData.lines) linesOf.set(l.split_sheet_id, [...(linesOf.get(l.split_sheet_id) ?? []), l]);

    matched = base.filter((c) => {
      const id = c.row.id;
      const mine = creditsOf.get(id) ?? [];
      const sheets = sheetsOf.get(id) ?? [];
      const facts: SongFacts = { ...c.facts };
      if (needs.has('credits')) facts.credits = mine.map((x) => ({ partyId: x.party_id?.toLowerCase() ?? null, role: x.role, status: x.status }));
      if (needs.has('recordings')) facts.recordings = recordings.get(id) ?? [];
      if (needs.has('legal_approval')) facts.legalApproval = legal.get(id) ?? 'none';
      if (needs.has('involved')) {
        const lines = sheets.flatMap((s) => linesOf.get(s.id) ?? []);
        facts.involvedPartyIds = involvedParties({
          credits: mine.map((x) => ({ partyId: x.party_id?.toLowerCase() ?? null })),
          splitPartyIds: lines.map((l) => l.party_id.toLowerCase()),
          accountUserIds: accounts.bySong.get(id) ?? [],
          partyUsers: accounts.partyUsers,
        });
      }
      if (needs.has('splits')) {
        const readiness: ReadinessSheet[] = sheets
          .filter((s) => isSplitKind(s.kind))
          .map((s) => ({
            id: s.id,
            kind: s.kind as 'composition' | 'master',
            version: s.version,
            status: s.status,
            lines: (linesOf.get(s.id) ?? []).map((l) => ({ partyId: l.party_id, role: l.role, share: l.share, signed: !!l.signed_at })),
          }));
        facts.splitsComplete = splitsAreComplete({ credits: mine, sheets: readiness, onRelease: c.onRelease });
      }
      return matchSong(filter, facts);
    });
  }

  const ordered = sortSongs(matched.map((c) => ({ ...c, id: c.row.id, createdAt: c.row.created_at })));
  const page = ordered.slice(offset, offset + limit);
  const rows = await resultRows(access, page);
  return { kind: 'songs', rows, total: ordered.length, more: offset + limit < ordered.length, unavailable: [] };
}

/** Titles for the page that is shown (names are read for these rows only). */
async function resultRows(access: OrgAccessOk, page: readonly Candidate[]): Promise<SongResultRow[]> {
  if (page.length === 0) return [];
  const { admin, orgId: org } = access;
  const artistIds = [...new Set(page.flatMap((c) => c.facts.artistIds[0] ?? []))];
  const projectIds = [...new Set(page.flatMap((c) => c.facts.projectIds[0] ?? []))];
  const [artists, projects] = await Promise.all([
    artistIds.length ? inChunks<{ id: string; name: string }>(artistIds, (part, from, to) => admin.from('contacts').select('id, name').eq('org_id', org).in('id', part).order('id').range(from, to), 'artist read') : Promise.resolve([]),
    projectIds.length ? inChunks<{ id: string; name: string }>(projectIds, (part, from, to) => admin.from('projects').select('id, name').eq('org_id', org).in('id', part).order('id').range(from, to), 'project read') : Promise.resolve([]),
  ]);
  const artistName = new Map(artists.map((a) => [a.id.toLowerCase(), a.name]));
  const projectName = new Map(projects.map((p) => [p.id.toLowerCase(), p.name]));
  return page.map((c) => {
    const a = c.facts.artistIds[0];
    const p = c.facts.projectIds[0];
    return {
      id: c.row.id,
      title: c.row.title,
      stage: c.row.song_stage,
      coverUrl: c.row.cover_url,
      bpm: c.row.bpm,
      key: c.row.key,
      createdAt: c.row.created_at,
      released: c.facts.released,
      artist: a && artistName.has(a) ? { id: a, name: artistName.get(a)! } : null,
      project: p && projectName.has(p) ? { id: p, name: projectName.get(p)! } : null,
    };
  });
}

// ── Releases ────────────────────────────────────────────────────────────

export async function runReleaseFilter(access: OrgAccessOk, filter: ReleaseFilter, opts: { limit?: number; offset?: number } = {}): Promise<ReleaseRun> {
  const limit = Math.min(Math.max(opts.limit ?? RUN_LIMIT, 1), RUN_MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);
  // Row predicates cut the list BEFORE any gate is evaluated, over the whole scoped list.
  const board = await loadReleaseBoard(access, {
    rowFilter: (r) =>
      matchReleaseBase(filter, {
        title: r.title,
        type: r.type,
        state: r.state,
        artistId: r.contact_id,
        targetDate: r.target_date,
        releaseDate: r.release_date,
        deliveredAt: r.delivered_at,
      }),
  });
  const rows = board.releases.filter((r) => (releaseNeedsGates(filter) ? matchRelease(filter, r) : true));
  const page = rows.slice(offset, offset + limit);
  return { kind: 'releases', rows: page, total: rows.length, more: offset + limit < rows.length, olderNotShown: board.more, schemaReady: board.schemaReady };
}

// ── Entry ───────────────────────────────────────────────────────────────

export async function runDefinition(access: OrgAccessOk, def: Definition, opts: { limit?: number; offset?: number } = {}): Promise<RunResult> {
  return def.subject === 'songs' ? runSongFilter(access, def.filter, opts) : runReleaseFilter(access, def.filter, opts);
}

// ── What this viewer may see of a definition's ids ──────────────────────

export async function visibleIdsFor(access: OrgAccessOk): Promise<VisibleIds> {
  const scoped = await orgProjectIdsInScope(access.admin, access);
  const artists = access.artistScope === null ? null : new Set([...access.artistScope].map((a) => a.toLowerCase()));
  const projects = scoped === null ? null : new Set(scoped.map((p) => p.toLowerCase()));
  let parties: Set<string> | null;
  if (!access.capabilities.has('rights.read')) parties = new Set();
  else if (access.artistScope === null) parties = null;
  else parties = new Set((await scopedPartyIds(access.admin, access)).map((p) => p.toLowerCase()));
  return { artists, parties, projects };
}

/** Names for the ids a definition mentions that this viewer may see (an id they may not see resolves to nothing). */
export async function namesFor(
  access: OrgAccessOk,
  ids: { artists: readonly string[]; parties: readonly string[]; projects: readonly string[] },
  visible: VisibleIds,
): Promise<{ artists: Map<string, string>; parties: Map<string, string>; projects: Map<string, string> }> {
  const { admin, orgId: org } = access;
  const ok = (set: ReadonlySet<string> | null, id: string) => set === null || set.has(id);
  const artists = ids.artists.filter((i) => ok(visible.artists, i));
  const parties = ids.parties.filter((i) => ok(visible.parties, i));
  const projects = ids.projects.filter((i) => ok(visible.projects, i));
  const [a, p, pr] = await Promise.all([
    artists.length ? admin.from('contacts').select('id, name').eq('org_id', org).in('id', artists) : Promise.resolve({ data: [], error: null }),
    parties.length ? admin.from('parties').select('id, display_name').eq('org_id', org).in('id', parties) : Promise.resolve({ data: [], error: null }),
    projects.length ? admin.from('projects').select('id, name').eq('org_id', org).in('id', projects) : Promise.resolve({ data: [], error: null }),
  ]);
  const map = <T extends { id: string }>(res: { data: unknown; error: { message: string } | null }, label: (r: T) => string) => {
    if (res.error) throw new Error(`name read: ${res.error.message}`);
    return new Map(((res.data ?? []) as T[]).map((r) => [r.id.toLowerCase(), label(r)] as const));
  };
  return {
    artists: map<{ id: string; name: string }>(a, (r) => r.name),
    parties: map<{ id: string; display_name: string }>(p, (r) => r.display_name),
    projects: map<{ id: string; name: string }>(pr, (r) => r.name),
  };
}
