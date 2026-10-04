import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Holds the TypeScript walks of "which org projects does an artist-scoped
 * member reach" equal to each other (LABEL-16's carry to LABEL-17):
 *
 *   - `orgProjectIdsInScope`  — the LIST walk, for routes over project-keyed tables
 *   - `requireObjectAccess`   — the SINGLE-object walk (`artistsThroughProjects`)
 *   - `artistProjects`        — one artist's projects (workspace, upload targets)
 *
 * and both equal to the rule SQL `can_see_org_project` states (migration 141):
 * an inbox artist or any `project_contacts` contact in the member's scope, and
 * only a project OF THE ORG. The SQL side is asserted against a real Postgres
 * in `supabase/local/checks/145_*.sql`; this file pins the TS side to the same
 * rule on one fixture, so a change to either walk fails here rather than
 * showing a member a project in a list that the project's own page refuses.
 */

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const USER = '00000000-0000-4000-8000-000000000001';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';
const P = (n: number) => `00000000-0000-4000-8000-0000000000d${n}`;

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

/** A small in-memory PostgREST: eq / in / is filters, maybeSingle, awaited lists. */
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const b = {
    select: () => b,
    eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), b),
    in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), b),
    is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), b),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (r: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
});

/** Projects in org A, each reaching its artists differently; one in org B. */
const PROJECTS: Row[] = [
  { id: P(1), org_id: ORG_A, inbox_for_contact_id: C1 }, //   inbox only
  { id: P(2), org_id: ORG_A, inbox_for_contact_id: null }, //  linked to C2
  { id: P(3), org_id: ORG_A, inbox_for_contact_id: null }, //  linked to C1 and C3
  { id: P(4), org_id: ORG_A, inbox_for_contact_id: C3 }, //    inbox C3 + linked C2
  { id: P(5), org_id: ORG_A, inbox_for_contact_id: null }, //  no artist at all
  { id: P(6), org_id: ORG_B, inbox_for_contact_id: null }, //  another org, linked to C1
];
const LINKS: Row[] = [
  { project_id: P(2), contact_id: C2 },
  { project_id: P(3), contact_id: C1 },
  { project_id: P(3), contact_id: C3 },
  { project_id: P(4), contact_id: C2 },
  { project_id: P(6), contact_id: C1 },
];
const A_PROJECT_IDS = PROJECTS.filter((p) => p.org_id === ORG_A).map((p) => p.id as string);

/** The rule written once, by hand — what `can_see_org_project` says. */
function expected(scope: string[]): string[] {
  return PROJECTS.filter(
    (p) =>
      p.org_id === ORG_A &&
      ((p.inbox_for_contact_id && scope.includes(p.inbox_for_contact_id as string)) ||
        LINKS.some((l) => l.project_id === p.id && scope.includes(l.contact_id as string))),
  )
    .map((p) => p.id as string)
    .sort();
}

const SCOPES: string[][] = [[C1], [C2], [C3], [C1, C2], [C2, C3], [C1, C2, C3], []];

function seed(scope: string[]) {
  tables = {
    projects: PROJECTS,
    project_contacts: LINKS,
    org_members: [
      {
        org_id: ORG_A,
        user_id: USER,
        role: 'member',
        functions: ['a_and_r'],
        scope: 'artists',
        cap_grants: [],
        cap_revokes: [],
        organizations: { kind: 'label', deleted_at: null },
      },
    ],
    member_artist_scopes: scope.map((contact_id) => ({ org_id: ORG_A, user_id: USER, contact_id })),
  };
}

describe('the list walk and the single-object walk reach the same projects', () => {
  for (const scope of SCOPES) {
    const label = scope.length === 0 ? 'no artists' : scope.map((c) => `C${c.slice(-1)}`).join('+');

    it(`scope ${label}: orgProjectIdsInScope equals the rule`, async () => {
      seed(scope);
      const { orgProjectIdsInScope } = await import('./org-access');
      const admin = { from } as unknown as Parameters<typeof orgProjectIdsInScope>[0];
      const ids = await orgProjectIdsInScope(admin, {
        orgId: ORG_A,
        artistScope: new Set(scope),
      } as unknown as Parameters<typeof orgProjectIdsInScope>[1]);
      expect(ids).toEqual(expected(scope));
    });

    it(`scope ${label}: requireObjectAccess opens exactly those projects (the rest are 404)`, async () => {
      seed(scope);
      const { requireObjectAccess } = await import('./org-access');
      const reached: string[] = [];
      for (const id of A_PROJECT_IDS) {
        const r = await requireObjectAccess({ table: 'projects', id, cap: 'catalog.read' });
        if (r.ok) reached.push(id);
        else expect(r.res.status).toBe(404);
      }
      expect(reached.sort()).toEqual(expected(scope));
    });
  }

  for (const contact of [C1, C2, C3]) {
    it(`artistProjects(C${contact.slice(-1)}) is the rule for that one artist`, async () => {
      seed([contact]);
      const { artistProjects } = await import('@/lib/labelos/org-workspace-store');
      const admin = { from } as unknown as Parameters<typeof artistProjects>[0];
      const got = (await artistProjects(admin, ORG_A, contact)).map((p) => p.id).sort();
      expect(got).toEqual(expected([contact]));
    });
  }

  it('another org’s project is never reached, even through a linked contact in scope', async () => {
    seed([C1]);
    const { requireObjectAccess } = await import('./org-access');
    const r = await requireObjectAccess({ table: 'projects', id: P(6), cap: 'catalog.read' });
    expect(r.ok).toBe(false);
  });
});
