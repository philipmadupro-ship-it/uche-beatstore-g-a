/**
 * LABEL-37 against the REAL org-access and the real filter store, over an
 * in-memory database (mocks/filters-fixture.ts). The seven 08 §A2 queries each
 * run as the owner, and the per-viewer rules are proved on the same data:
 * artist scope, D4, and the rights clauses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAdmin, type MemoryDb } from './mocks/memory-db';
import { AR_K, C1, C2, L, MKT, OWN, PB, PROD, PX, AR, S1, S2, S3, S4, filtersDb, R1, LP1 } from './mocks/filters-fixture';
import { exampleQueries, parseDefinition, type Definition } from './filters';
import { runDefinition, runSongFilter, type ReleaseRun, type SongRun, visibleIdsFor } from './filters-store';
import { requireOrgCapability, type OrgAccessOk } from '@/lib/auth/org-access';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  db = filtersDb();
});

async function as(user: string): Promise<OrgAccessOk> {
  current = user;
  const access = await requireOrgCapability(L, 'catalog.read');
  if (!access.ok) throw new Error(`no access for ${user}`);
  return access;
}

const Q = Object.fromEntries(exampleQueries({ producer: PX, artistA: C2, featured: PB }, 2026).map((q) => [q.key, q.definition]));
const songsOf = async (user: string, def: Definition) => {
  const run = (await runDefinition(await as(user), def)) as SongRun;
  return run.rows.map((r) => r.id).sort();
};
const want = (...ids: string[]) => [...ids].sort();

describe('the seven 08 §A2 queries, run by the owner', () => {
  it('1. all songs produced by Producer X', async () => {
    expect(await songsOf(OWN, Q['produced-by'])).toEqual(want(S1)); // S3 credits X as a mixer
  });
  it('2. Artist A (Kilo) demos from September', async () => {
    expect(await songsOf(OWN, Q['demos-september'])).toEqual(want(S2));
  });
  it('3. songs missing artwork', async () => {
    expect(await songsOf(OWN, Q['missing-artwork'])).toEqual(want(S1, S2, S4));
  });
  it('4. projects waiting for legal (songs and releases)', async () => {
    expect(await songsOf(OWN, Q['waiting-legal'])).toEqual(want(S2)); // S3 was asked, then approved
    const releases = parseDefinition({ v: 1, subject: 'releases', filter: { gates: [{ gate: 'legal', status: ['awaiting_approval', 'blocked', 'not_started'] }] } });
    expect(releases.ok).toBe(true);
    if (releases.ok) {
      const run = (await runDefinition(await as(OWN), releases.definition)) as ReleaseRun;
      expect(run.kind).toBe('releases');
      expect(run.rows.map((r) => r.id)).toEqual([R1]);
    }
  });
  it('5. everything involving Producer X (credited, or the account that uploaded it)', async () => {
    expect(await songsOf(OWN, Q['involving'])).toEqual(want(S1, S3, S4));
  });
  it('6. unreleased songs featuring Bea', async () => {
    expect(await songsOf(OWN, Q['unreleased-featuring'])).toEqual(want(S1)); // S3 is on a release
  });
  it('7. songs where splits are not complete', async () => {
    expect(await songsOf(OWN, Q['splits-incomplete'])).toEqual(want(S2, S4));
  });
});

describe('results are the VIEWER’s: artist scope and D4 come first', () => {
  it('a member limited to Kilo gets only Kilo’s songs from the same view', async () => {
    expect(await songsOf(OWN, Q['missing-artwork'])).toEqual(want(S1, S2, S4));
    expect(await songsOf(AR_K, Q['missing-artwork'])).toEqual(want(S2));
    expect(await songsOf(AR_K, Q['splits-incomplete'])).toEqual(want(S2));
    expect(await songsOf(AR_K, Q['waiting-legal'])).toEqual(want(S2));
  });
  it('naming an artist outside the scope matches nothing — never the rest of the view', async () => {
    const nova = parseDefinition({ v: 1, subject: 'songs', filter: { artistIds: [C1], missing: ['artwork'] } });
    if (!nova.ok) throw new Error(nova.error);
    expect(await songsOf(OWN, nova.definition)).toEqual(want(S1, S4));
    expect(await songsOf(AR_K, nova.definition)).toEqual([]);
  });
  it('no counts of what is hidden: total is the viewer’s own matches', async () => {
    const run = (await runDefinition(await as(AR_K), Q['missing-artwork'])) as SongRun;
    expect(run.total).toBe(1);
    expect(run.more).toBe(false);
    expect(JSON.stringify(run)).not.toContain(S1);
    expect(JSON.stringify(run)).not.toContain('Nova');
  });
  it('D4: a marketing member filters only the songs whose row they may read, and hears no demo', async () => {
    // S3 is selected and on a release (finished); the others are working songs.
    expect(await songsOf(MKT, Q['missing-artwork'])).toEqual([]);
    const all = parseDefinition({ v: 1, subject: 'songs', filter: { stages: ['selected', 'inbox', 'in_review', 'in_development'] } });
    if (!all.ok) throw new Error(all.error);
    expect(await songsOf(MKT, all.definition)).toEqual(want(S3));
    // …and S2’s demo does not make S2 findable by "has a demo".
    expect(await songsOf(MKT, Q['demos-september'])).toEqual([]);
  });
});

describe('rights clauses need rights.read (and approvals the approval abilities)', () => {
  it('a member without them gets no rows and the list of what is unavailable', async () => {
    const run = (await runDefinition(await as(PROD), Q['produced-by'])) as SongRun;
    expect(run).toMatchObject({ rows: [], total: 0, more: false, unavailable: ['credits'] });
    const splits = (await runDefinition(await as(PROD), Q['splits-incomplete'])) as SongRun;
    expect(splits.unavailable).toEqual(['splits']);
    const legal = (await runDefinition(await as(PROD), Q['waiting-legal'])) as SongRun;
    expect(legal.unavailable).toEqual(['legal_approval']);
  });
  it('the same view works for a member who holds them', async () => {
    expect(await songsOf(AR, Q['produced-by'])).toEqual(want(S1));
    expect(await songsOf(AR, Q['waiting-legal'])).toEqual(want(S2));
  });
});

describe('visible ids and fail-closed reads', () => {
  it('an unscoped viewer sees every id; a scoped one only their artists’ and none of the parties unless rights.read', async () => {
    expect(await visibleIdsFor(await as(OWN))).toEqual({ artists: null, parties: null, projects: null });
    const scoped = await visibleIdsFor(await as(AR_K));
    expect([...scoped.artists!]).toEqual([C2]);
    expect(scoped.projects!.has(LP1)).toBe(false);
    const noRights = await visibleIdsFor(await as(PROD));
    expect(noRights.parties).toEqual(new Set());
  });
  it('a missing table (migration not applied) contributes nothing: a clause that needs it matches no song', async () => {
    delete db.tables.track_collaborators;
    // memory-db answers a missing table with an empty set; the clause has nothing to match.
    expect(await songsOf(OWN, Q['produced-by'])).toEqual([]);
  });
  it('paging: limit and offset cut the ordered, viewer-filtered list', async () => {
    const access = await as(OWN);
    const first = await runSongFilter(access, {}, { limit: 2 });
    expect(first.rows.map((r) => r.id)).toEqual([S4, S3]); // newest first
    expect(first).toMatchObject({ total: 4, more: true });
    const next = await runSongFilter(access, {}, { limit: 2, offset: 2 });
    expect(next.rows.map((r) => r.id)).toEqual([S2, S1]);
    expect(next.more).toBe(false);
  });
});
