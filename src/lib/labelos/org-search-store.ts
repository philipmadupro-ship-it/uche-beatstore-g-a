/**
 * Org search reads (LABEL-36). Service-role reads, the org filter on every
 * query; authorisation (`catalog.read`, the org) is the route's. Everything
 * a candidate row must clear before it becomes a hit:
 *
 *  - ARTIST SCOPE — a member limited to some artists (and a roster artist,
 *    always) is searched only inside the projects and contacts that scope
 *    reaches (`orgProjectIdsInScope`, `scopedOrgQuery`: the TS twins of
 *    `can_see_org_project` / `can_see_artist`). The scope is pushed into the
 *    query where it can be, so out-of-scope rows cannot crowd in-scope ones
 *    out of the candidate window, and it is checked again on the rows.
 *  - D4 — a song's row is judged by `orgTrackFacts` + `memberSeesTrackRow`
 *    (a marketing member does not find a demo); a file by `canReadOrgAsset`
 *    (restricted / working kinds need their capabilities); parties by
 *    `rights.read` (and the scope of the songs they are credited on).
 *  - Producer rows have a NULL search vector (migration 159) and the org
 *    filter besides: they cannot match.
 *
 * A row that fails any of this is dropped without trace — no count, no hint.
 * The 159 columns missing (migration not applied) answers `schemaReady:
 * false`; releases / parties missing (144 / 153) just contribute nothing.
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { orgProjectIdsInScope, scopedOrgQuery } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { ORG_ASSET_KIND_LABEL, canReadOrgAsset, isOrgAssetKind } from './org-assets';
import { orgTrackFacts } from './org-workspace-store';
import { memberSeesTrackRow, songStageLabel } from './org-workspace';
import { scopedPartyIds } from './credits-store';
import { NO_WORKSPACE, isRosterContact } from './roster';
import {
  CANDIDATES_PER_TABLE,
  EMPTY_SEARCH,
  detectIdentifier,
  groupHits,
  parseSearchQuery,
  rankHits,
  type IdentifierQuery,
  type OrgSearchResult,
  type ParsedQuery,
  type SearchHit,
} from './org-search';

export class SearchNotReadyError extends Error {
  constructor() {
    super('Search needs migration 159 applied on Supabase.');
  }
}

type Err = { message: string; code?: string } | null;
type Res = { data: unknown; error: Err };

const CHUNK = 100;
function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The rows of a read; a missing 159 column is the one error that means "not ready", other missing tables mean "none". */
function rowsOf<T>(res: Res, what: string, opts: { searchColumn?: boolean } = {}): T[] {
  if (res.error) {
    if (opts.searchColumn && /search_tsv/.test(res.error.message)) throw new SearchNotReadyError();
    if (isMissingSchema(res.error)) return [];
    throw new Error(`${what}: ${res.error.message}`);
  }
  return (res.data ?? []) as T[];
}

type Scope = { projects: string[] | null };

/** The tracks (of the candidates) that sit in a project the member's scope reaches; everything when unscoped. */
async function tracksInScope(admin: AdminClient, scope: Scope, trackIds: readonly string[]): Promise<Set<string>> {
  if (scope.projects === null) return new Set(trackIds);
  if (scope.projects.length === 0 || trackIds.length === 0) return new Set();
  const inScope = new Set(scope.projects);
  const ok = new Set<string>();
  for (const part of chunks([...new Set(trackIds)])) {
    const links = rowsOf<{ project_id: string; track_id: string }>(
      await admin.from('project_tracks').select('project_id, track_id').in('track_id', part),
      'search placement read',
    );
    for (const l of links) if (inScope.has(l.project_id)) ok.add(l.track_id);
  }
  return ok;
}

type SongRow = { id: string; title: string | null; type: string | null; song_stage: string | null };

/** Songs the member may see as rows: scope first, then D4's row rule. */
async function visibleSongs(access: OrgAccessOk, scope: Scope, rows: readonly SongRow[]): Promise<SongRow[]> {
  const songs = rows.filter((r) => r.type === 'song' && r.song_stage !== null);
  if (songs.length === 0) return [];
  const inScope = await tracksInScope(access.admin, scope, songs.map((s) => s.id));
  const scoped = songs.filter((s) => inScope.has(s.id));
  if (scoped.length === 0) return [];
  const facts = await orgTrackFacts(access.admin, access.orgId, scoped.map((s) => s.id));
  return scoped.filter((s) => {
    const f = facts.get(s.id);
    return !!f && memberSeesTrackRow(access.capabilities, f);
  });
}

const songHit = (s: SongRow): SearchHit => ({ group: 'songs', id: s.id, title: s.title ?? 'Untitled', sub: songStageLabel(s.song_stage) });

// ── Text search, one read per table ─────────────────────────────────────

async function searchSongs(access: OrgAccessOk, scope: Scope, q: ParsedQuery): Promise<SearchHit[]> {
  const { admin, orgId } = access;
  const base = () => admin.from('tracks').select('id, title, type, song_stage').eq('org_id', orgId).eq('type', 'song')
    .not('song_stage', 'is', null).textSearch('search_tsv', q.tsquery!, { config: 'simple' }).limit(CANDIDATES_PER_TABLE);
  let rows: SongRow[];
  if (scope.projects === null) {
    rows = rowsOf<SongRow>(await base(), 'song search', { searchColumn: true });
  } else {
    // Inside the scope: the scoped projects' tracks are the only ones searched.
    const placed = new Set<string>();
    for (const part of chunks(scope.projects)) {
      for (const l of rowsOf<{ track_id: string }>(await admin.from('project_tracks').select('track_id').in('project_id', part), 'search placement read')) placed.add(l.track_id);
    }
    rows = [];
    for (const part of chunks([...placed])) {
      rows.push(...rowsOf<SongRow>(await base().in('id', part), 'song search', { searchColumn: true }));
    }
  }
  return (await visibleSongs(access, scope, rows)).map(songHit);
}

async function searchContacts(access: OrgAccessOk, q: ParsedQuery): Promise<SearchHit[]> {
  // scopedOrgQuery narrows a scoped member to their own contacts (none → none).
  const res = await scopedOrgQuery(access.admin, 'contacts', access, 'id, name, category, secondary_category, role')
    .textSearch('search_tsv', q.tsquery!, { config: 'simple' })
    .limit(CANDIDATES_PER_TABLE);
  const rows = rowsOf<{ id: string; name: string; category: string | null; secondary_category: string | null; role: string | null }>(res as Res, 'contact search', { searchColumn: true });
  return rows.map((c) =>
    isRosterContact(c, NO_WORKSPACE)
      ? { group: 'artists' as const, id: c.id, title: c.name, sub: null }
      : { group: 'people' as const, id: c.id, title: c.name, sub: c.role || c.category || null },
  );
}

async function searchProjects(access: OrgAccessOk, scope: Scope, q: ParsedQuery): Promise<SearchHit[]> {
  const base = () => access.admin.from('projects').select('id, name').eq('org_id', access.orgId)
    .textSearch('search_tsv', q.tsquery!, { config: 'simple' }).limit(CANDIDATES_PER_TABLE);
  let rows: { id: string; name: string }[] = [];
  if (scope.projects === null) rows = rowsOf(await base(), 'project search', { searchColumn: true });
  else for (const part of chunks(scope.projects)) rows.push(...rowsOf<{ id: string; name: string }>(await base().in('id', part), 'project search', { searchColumn: true }));
  return rows.map((p) => ({ group: 'projects' as const, id: p.id, title: p.name, sub: null }));
}

async function searchFiles(access: OrgAccessOk, scope: Scope, q: ParsedQuery): Promise<SearchHit[]> {
  const base = () => access.admin.from('project_assets').select('id, project_id, kind, sensitivity, label, file_name').eq('org_id', access.orgId)
    .textSearch('search_tsv', q.tsquery!, { config: 'simple' }).limit(CANDIDATES_PER_TABLE);
  type Row = { id: string; project_id: string; kind: string; sensitivity: string; label: string | null; file_name: string | null };
  const rows: Row[] = [];
  if (scope.projects === null) rows.push(...rowsOf<Row>(await base(), 'file search', { searchColumn: true }));
  else for (const part of chunks(scope.projects)) rows.push(...rowsOf<Row>(await base().in('project_id', part), 'file search', { searchColumn: true }));
  return rows
    .filter((r) => canReadOrgAsset(access.capabilities, r))
    .map((r) => ({
      group: 'files' as const,
      id: r.id,
      title: r.label || r.file_name || 'File',
      sub: isOrgAssetKind(r.kind) ? ORG_ASSET_KIND_LABEL[r.kind] : null,
      projectId: r.project_id,
    }));
}

async function searchReleases(access: OrgAccessOk, scope: Scope, q: ParsedQuery): Promise<SearchHit[]> {
  const base = () => access.admin.from('releases').select('id, title, state, project_id').eq('org_id', access.orgId)
    .textSearch('search_tsv', q.tsquery!, { config: 'simple' }).limit(CANDIDATES_PER_TABLE);
  type Row = { id: string; title: string; state: string };
  const rows: Row[] = [];
  if (scope.projects === null) rows.push(...rowsOf<Row>(await base(), 'release search', { searchColumn: false }));
  else for (const part of chunks(scope.projects)) rows.push(...rowsOf<Row>(await base().in('project_id', part), 'release search', { searchColumn: false }));
  return rows.map((r) => ({ group: 'releases' as const, id: r.id, title: r.title, sub: r.state }));
}

async function searchParties(access: OrgAccessOk, q: ParsedQuery): Promise<SearchHit[]> {
  // Parties carry legal names and IPI numbers: only a member who reads rights data searches them.
  if (!access.capabilities.has('rights.read')) return [];
  const res = await access.admin.from('parties').select('id, display_name, kind').eq('org_id', access.orgId)
    .textSearch('search_tsv', q.tsquery!, { config: 'simple' }).limit(CANDIDATES_PER_TABLE);
  let rows = rowsOf<{ id: string; display_name: string; kind: string }>(res as Res, 'party search');
  if (access.artistScope !== null && rows.length > 0) {
    const visible = new Set(await scopedPartyIds(access.admin, access));
    rows = rows.filter((p) => visible.has(p.id));
  }
  return rows.map((p) => ({ group: 'people' as const, id: p.id, title: p.display_name, sub: p.kind }));
}

// ── Identifier jump ─────────────────────────────────────────────────────

/** The songs a recording (a master, an instrumental, a beat, or a song itself) belongs to. */
async function songsOfRecording(admin: AdminClient, orgId: string, recordingIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(recordingIds.map((id) => [id, []]));
  if (recordingIds.length === 0) return out;
  const [links, beats, mains] = await Promise.all([
    admin.from('track_links').select('from_track_id, to_track_id').in('to_track_id', [...recordingIds]),
    admin.from('song_beats').select('song_track_id, beat_track_id').in('beat_track_id', [...recordingIds]),
    admin.from('tracks').select('id, beat_track_id').eq('org_id', orgId).in('beat_track_id', [...recordingIds]),
  ]);
  const add = (rec: string, song: string) => out.get(rec)?.push(song);
  for (const l of rowsOf<{ from_track_id: string; to_track_id: string }>(links as Res, 'recording links')) add(l.to_track_id, l.from_track_id);
  for (const b of rowsOf<{ song_track_id: string; beat_track_id: string }>(beats as Res, 'recording beats')) add(b.beat_track_id, b.song_track_id);
  for (const m of rowsOf<{ id: string; beat_track_id: string }>(mains as Res, 'recording main beats')) add(m.beat_track_id, m.id);
  return out;
}

async function jumpToRecording(access: OrgAccessOk, scope: Scope, column: 'isrc' | 'iswc', value: string): Promise<SearchHit | null> {
  const { admin, orgId } = access;
  const found = rowsOf<SongRow>(
    await admin.from('tracks').select('id, title, type, song_stage').eq('org_id', orgId).eq(column, value).limit(10),
    'identifier read',
  );
  if (found.length === 0) return null;
  // The code names a recording; the page that shows it is its song's.
  const bySong = await songsOfRecording(admin, orgId, found.map((t) => t.id));
  const songIds = new Set<string>();
  for (const t of found) {
    if (t.type === 'song') songIds.add(t.id);
    for (const s of bySong.get(t.id) ?? []) songIds.add(s);
  }
  const songRows = rowsOf<SongRow>(
    songIds.size ? await admin.from('tracks').select('id, title, type, song_stage').eq('org_id', orgId).eq('type', 'song').in('id', [...songIds]) : { data: [], error: null },
    'identifier songs',
  );
  const songs = await visibleSongs(access, scope, songRows);
  if (songs.length === 0) return null;
  // The recording itself must be readable too (a hidden demo carrying the code is not a way in).
  const facts = await orgTrackFacts(admin, orgId, found.map((t) => t.id));
  const inScope = await tracksInScope(admin, scope, found.map((t) => t.id));
  const readable = new Set(found.filter((t) => {
    const f = facts.get(t.id);
    return !!f && memberSeesTrackRow(access.capabilities, f) && inScope.has(t.id);
  }).map((t) => t.id));
  const reachable = songs.filter((s) => found.some((t) => readable.has(t.id) && (t.id === s.id || (bySong.get(t.id) ?? []).includes(s.id))));
  const first = rankHits({ text: '', terms: [], tsquery: null }, reachable.map(songHit))[0];
  return first ?? null;
}

async function jumpToRelease(access: OrgAccessOk, scope: Scope, upc: string): Promise<SearchHit | null> {
  const rows = rowsOf<{ id: string; title: string; state: string; project_id: string }>(
    await access.admin.from('releases').select('id, title, state, project_id').eq('org_id', access.orgId).eq('upc', upc).limit(5),
    'release identifier read',
  );
  const ok = rows.filter((r) => scope.projects === null || scope.projects.includes(r.project_id));
  return ok[0] ? { group: 'releases', id: ok[0].id, title: ok[0].title, sub: ok[0].state } : null;
}

async function jumpToParty(access: OrgAccessOk, ipi: string): Promise<SearchHit | null> {
  if (!access.capabilities.has('rights.read')) return null;
  const rows = rowsOf<{ id: string; display_name: string; kind: string }>(
    await access.admin.from('parties').select('id, display_name, kind').eq('org_id', access.orgId).eq('ipi', ipi).limit(5),
    'party identifier read',
  );
  let list = rows;
  if (access.artistScope !== null && list.length > 0) {
    const visible = new Set(await scopedPartyIds(access.admin, access));
    list = list.filter((p) => visible.has(p.id));
  }
  return list[0] ? { group: 'people', id: list[0].id, title: list[0].display_name, sub: list[0].kind } : null;
}

async function identifierJump(access: OrgAccessOk, scope: Scope, id: IdentifierQuery): Promise<SearchHit | null> {
  switch (id.kind) {
    case 'isrc':
      return jumpToRecording(access, scope, 'isrc', id.value);
    case 'iswc':
      return jumpToRecording(access, scope, 'iswc', id.value);
    case 'upc':
      return jumpToRelease(access, scope, id.value);
    case 'ipi':
      return jumpToParty(access, id.value);
  }
}

// ── Entry ───────────────────────────────────────────────────────────────

/**
 * Search the org for what the caller may see. An identifier query that
 * matches a visible object returns it as `jump` (and nothing else); any
 * other query — or an identifier that matched nothing the caller may open —
 * is a prefix-AND word search over the six tables. Throws
 * `SearchNotReadyError` before migration 159.
 */
export async function searchOrg(access: OrgAccessOk, raw: unknown): Promise<OrgSearchResult> {
  const q = parseSearchQuery(raw);
  if (!q.tsquery) return EMPTY_SEARCH;
  const scope: Scope = { projects: await orgProjectIdsInScope(access.admin, access) };

  const identifier = detectIdentifier(raw);
  if (identifier) {
    const jump = await identifierJump(access, scope, identifier);
    if (jump) return { jump, groups: [] };
  }

  const parts = await Promise.all([
    searchSongs(access, scope, q),
    searchContacts(access, q),
    searchReleases(access, scope, q),
    searchParties(access, q),
    searchProjects(access, scope, q),
    searchFiles(access, scope, q),
  ]);
  return { jump: null, groups: groupHits(q, parts.flat()) };
}
