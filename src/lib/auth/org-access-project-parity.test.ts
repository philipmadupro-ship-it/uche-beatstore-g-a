import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

/**
 * Holds the TypeScript walks of "does this person reach this project" equal
 * to each other and to the rule SQL `public.can_see_project` states
 * (migration 148; the SQL side is asserted against a real Postgres in
 * supabase/local/checks/148_labelos_project_members.sql). The sibling of
 * org-access-scope-parity.test.ts, which does the same for the artist-scope
 * walks of `can_see_org_project`:
 *
 *   can_see_project(project) =
 *        the project is an ORG project of a live org, and
 *        ( the caller has a LIVE project_members row for it
 *          OR ( the caller is an org member with catalog.read
 *               AND can_see_org_project — their artist scope reaches it ) )
 *
 * One fixture, every user × every project. The walks compared:
 *   requireProjectActor       — the single-project walk the routes use
 *   requireExternalProject    — the external half alone
 *   requireExternalTrack      — the same rule reached through a track
 *   myExternalProjects        — the list "Shared with me" shows
 * and the two halves never leak into each other: an external membership
 * never makes someone an org member (requireOrgMember stays 403).
 */

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const ORG_GONE = '00000000-0000-4000-8000-00000000000c';
const u = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EXT1 = u(1); // live on P1, expired on P3
const EXT2 = u(2); // live on P2 (org A) and P6 (org B)
const ORGM = u(3); // whole-org A&R of A
const SCOPED = u(4); // A&R of A limited to artist C1
const FIN = u(5); // finance of A: no catalog.read
const STRANGER = u(6);
const GONE = u(7); // live external member in a soft-deleted org
const BOTH = u(8); // scoped org member AND external member of P2
const C1 = '20000000-0000-4000-8000-0000000000c1';
const C2 = '20000000-0000-4000-8000-0000000000c2';
const P = (n: number) => `30000000-0000-4000-8000-00000000000${n}`;
const T = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;

type Row = Record<string, unknown>;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let current: string | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

const PROJECTS: Row[] = [
  { id: P(1), org_id: ORG_A, inbox_for_contact_id: C1, name: 'P1' }, //  artist C1
  { id: P(2), org_id: ORG_A, inbox_for_contact_id: C2, name: 'P2' }, //  artist C2
  { id: P(3), org_id: ORG_A, inbox_for_contact_id: C1, name: 'P3' }, //  artist C1 (EXT1's membership expired)
  { id: P(4), org_id: ORG_A, inbox_for_contact_id: null, name: 'P4' }, // no artist
  { id: P(5), org_id: null, inbox_for_contact_id: null, name: 'P5' }, //  a producer project
  { id: P(6), org_id: ORG_B, inbox_for_contact_id: null, name: 'P6' }, // another org
  { id: P(7), org_id: ORG_GONE, inbox_for_contact_id: null, name: 'P7' }, // a soft-deleted org
];
const MEMBERS: Row[] = [
  { org_id: ORG_A, project_id: P(1), user_id: EXT1, role: 'viewer', allow_downloads: false, expires_at: FUTURE },
  { org_id: ORG_A, project_id: P(3), user_id: EXT1, role: 'editor', allow_downloads: false, expires_at: PAST },
  { org_id: ORG_A, project_id: P(2), user_id: EXT2, role: 'contributor', allow_downloads: false, expires_at: null },
  { org_id: ORG_B, project_id: P(6), user_id: EXT2, role: 'viewer', allow_downloads: false, expires_at: null },
  { org_id: ORG_GONE, project_id: P(7), user_id: GONE, role: 'editor', allow_downloads: false, expires_at: null },
  { org_id: ORG_A, project_id: P(2), user_id: BOTH, role: 'commenter', allow_downloads: false, expires_at: null },
];
const ORG_MEMBERS = (user: string, functions: string[], scope: string) => ({
  org_id: ORG_A, user_id: user, role: 'member', functions, scope, cap_grants: [], cap_revokes: [],
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [
        { id: ORG_A, name: 'Org A', kind: 'label', deleted_at: null },
        { id: ORG_B, name: 'Org B', kind: 'label', deleted_at: null },
        { id: ORG_GONE, name: 'Gone', kind: 'label', deleted_at: '2026-01-01' },
      ],
      org_members: [
        ORG_MEMBERS(ORGM, ['a_and_r'], 'org'),
        ORG_MEMBERS(SCOPED, ['a_and_r'], 'artists'),
        ORG_MEMBERS(FIN, ['finance'], 'org'),
        ORG_MEMBERS(BOTH, ['a_and_r'], 'artists'),
      ],
      member_artist_scopes: [
        { org_id: ORG_A, user_id: SCOPED, contact_id: C1 },
        { org_id: ORG_A, user_id: BOTH, contact_id: C1 },
      ],
      projects: PROJECTS.map((p) => ({ ...p })),
      project_contacts: [],
      project_members: MEMBERS.map((m) => ({ ...m })),
      tracks: PROJECTS.map((p, i) => ({ id: T(i + 1), org_id: p.org_id, title: `T${i + 1}` })),
      project_tracks: PROJECTS.map((p, i) => ({ project_id: p.id, track_id: T(i + 1), position: 0 })),
    },
  };
  mem = memoryAdmin(db);
});

const USERS = { EXT1, EXT2, ORGM, SCOPED, FIN, STRANGER, GONE, BOTH };

/** `can_see_project`, written once by hand, from the fixture. */
function sees(user: string, project: Row): boolean {
  const org = project.org_id as string | null;
  if (!org) return false;
  const orgRow = db.tables.organizations.find((o) => o.id === org);
  if (!orgRow || orgRow.deleted_at) return false;
  const external = db.tables.project_members.some(
    (m) => m.user_id === user && m.project_id === project.id && m.org_id === org && (m.expires_at === null || String(m.expires_at) > new Date().toISOString()),
  );
  if (external) return true;
  const member = db.tables.org_members.find((m) => m.org_id === org && m.user_id === user);
  if (!member) return false;
  const catalogRead = !(member.functions as string[]).includes('finance') || (member.functions as string[]).length > 1;
  if (!catalogRead) return false;
  if (member.scope === 'org') return true;
  const scope = db.tables.member_artist_scopes.filter((s) => s.org_id === org && s.user_id === user).map((s) => s.contact_id);
  return scope.includes(project.inbox_for_contact_id as string);
}

describe('every user × every project: the TS walks equal can_see_project', () => {
  for (const [name, user] of Object.entries(USERS)) {
    it(`${name}: requireProjectActor reaches exactly the projects the rule says`, async () => {
      current = user;
      const { requireProjectActor } = await import('./org-access');
      for (const project of PROJECTS) {
        const r = await requireProjectActor({ projectId: project.id as string, cap: 'catalog.read' });
        expect(r.ok, `${name} → ${project.name}`).toBe(sees(user, project));
        if (!r.ok) expect([403, 404]).toContain(r.res.status);
      }
    });

    it(`${name}: the external half alone is exactly the live memberships`, async () => {
      current = user;
      const { requireExternalProject, requireExternalTrack } = await import('./org-access');
      for (const [i, project] of PROJECTS.entries()) {
        const live = db.tables.project_members.some(
          (m) => m.user_id === user && m.project_id === project.id && (m.expires_at === null || String(m.expires_at) > new Date().toISOString()),
        ) && !!project.org_id && !db.tables.organizations.find((o) => o.id === project.org_id)?.deleted_at;
        const asProject = await requireExternalProject({ projectId: project.id as string });
        const asTrack = await requireExternalTrack({ trackId: T(i + 1) });
        expect(asProject.ok, `${name} → project ${project.name}`).toBe(live);
        expect(asTrack.ok, `${name} → track in ${project.name}`).toBe(live);
        if (asProject.ok) expect(asProject.memberships.map((m) => m.projectId)).toEqual([project.id]);
        else expect(asProject.res.status).toBe(404);
      }
    });

    it(`${name}: "Shared with me" lists exactly the live external projects`, async () => {
      current = user;
      const { myExternalProjects } = await import('./org-access');
      const list = await myExternalProjects();
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      const expected = PROJECTS.filter(
        (p) =>
          p.org_id &&
          !db.tables.organizations.find((o) => o.id === p.org_id)?.deleted_at &&
          db.tables.project_members.some((m) => m.user_id === user && m.project_id === p.id && (m.expires_at === null || String(m.expires_at) > new Date().toISOString())),
      ).map((p) => p.id as string);
      expect(list.projects.map((p) => p.id).sort()).toEqual(expected.sort());
    });
  }

  it('an expired membership of the same person is not live, a live one beside it is', async () => {
    current = EXT1;
    const { requireExternalProject } = await import('./org-access');
    expect((await requireExternalProject({ projectId: P(1) })).ok).toBe(true);
    expect((await requireExternalProject({ projectId: P(3) })).ok).toBe(false);
  });
});

describe('the two halves never leak into each other', () => {
  it('an external member is never an org member: every org-level helper still refuses them', async () => {
    current = EXT2;
    const { requireOrgMember, requireOrgCapability, requireObjectAccess } = await import('./org-access');
    const member = await requireOrgMember(ORG_A);
    expect(member.ok).toBe(false);
    if (!member.ok) expect(member.res.status).toBe(403);
    expect((await requireOrgCapability(ORG_A, 'catalog.read')).ok).toBe(false);
    for (const table of ['projects'] as const) {
      const r = await requireObjectAccess({ table, id: P(2), cap: 'catalog.read' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.res.status).toBe(404);
    }
  });

  it('an artists-scoped org member who is also external on a project outside their scope reaches it as EXTERNAL, with no org capability', async () => {
    current = BOTH;
    const { requireProjectActor } = await import('./org-access');
    const out = await requireProjectActor({ projectId: P(2), cap: 'catalog.read' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.kind).toBe('external');
    const inScope = await requireProjectActor({ projectId: P(1), cap: 'catalog.read' });
    expect(inScope.ok && inScope.kind).toBe('org');
  });

  it('a member lacking the capability keeps the org refusal (403), not an external 404', async () => {
    current = FIN;
    const { requireProjectActor } = await import('./org-access');
    const r = await requireProjectActor({ projectId: P(1), cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('an unknown or producer project is 404 for everyone', async () => {
    for (const user of Object.values(USERS)) {
      current = user;
      const { requireProjectActor } = await import('./org-access');
      for (const id of [P(5), '30000000-0000-4000-8000-0000000000ff', 'nope']) {
        const r = await requireProjectActor({ projectId: id, cap: 'catalog.read' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.res.status).toBe(404);
      }
    }
  });
});
