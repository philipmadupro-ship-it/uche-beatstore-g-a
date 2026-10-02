import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The org-access state machine (LABEL-05). Same mocking pattern as
 * ownership.test.ts: the cookie client answers "who is calling", a fake
 * service-role client answers each table read. Every branch:
 *
 *   requireOrgMember / requireOrgCapability
 *     - no session                         → 401
 *     - malformed or unknown org id        → 403 (not a member)
 *     - not a member                       → 403
 *     - member of a soft-deleted org       → 403
 *     - membership read errors             → 500
 *     - member without the capability      → 403
 *     - member with it                     → ok, with the live capability set
 *
 *   requireObjectAccess
 *     - no session                         → 401
 *     - malformed id / row missing         → 404
 *     - producer row (org_id IS NULL)      → 404
 *     - row in an org the caller is not in → 404 (never 200, never reveals it)
 *     - row in another org than the URL's  → 404
 *     - member lacking the capability      → 403
 *     - member with it                     → ok, with the row's scope keys
 *     - artist scope (LABEL-10): a scoped member gets 404 outside their
 *       contacts, for objects with no contact, and with zero contacts; the
 *       scope read failing is 500
 *     - projects / tracks (LABEL-12): scoped through the project's inbox
 *       artist and linked contacts, a track through the projects of its
 *       own org it sits in; a failed lookup is 500
 *
 *   scopedOrgQuery
 *     - org filter always; artist-scope filter on org object tables only
 */

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const USER = '00000000-0000-4000-8000-000000000001';
const ROW = '00000000-0000-4000-8000-0000000000f1';
const CONTACT = '00000000-0000-4000-8000-0000000000c1';
const PROJECT = '00000000-0000-4000-8000-0000000000d1';

type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; op: string; args: unknown[] };

const mockGetUser = vi.fn();
let calls: Call[] = [];
/** Per table: what the next `maybeSingle()` resolves to. */
let answers: Record<string, Result | ((filters: Record<string, unknown>) => Result)> = {};

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  const b = {
    select: (...args: unknown[]) => {
      calls.push({ table, op: 'select', args });
      return b;
    },
    eq: (col: string, value: unknown) => {
      calls.push({ table, op: 'eq', args: [col, value] });
      filters[col] = value;
      return b;
    },
    in: (col: string, values: unknown[]) => {
      calls.push({ table, op: 'in', args: [col, values] });
      return b;
    },
    is: (col: string, value: unknown) => {
      calls.push({ table, op: 'is', args: [col, value] });
      return b;
    },
    maybeSingle: async () => {
      const a = answers[table];
      if (!a) return { data: null, error: null };
      return typeof a === 'function' ? a(filters) : a;
    },
    // A list read (member_artist_scopes) is awaited directly.
    then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      const a = answers[table];
      const r = !a ? { data: [], error: null } : typeof a === 'function' ? a(filters) : a;
      return Promise.resolve(r).then(resolve, reject);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => builder(table) }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  mockGetUser.mockReset();
  calls = [];
  answers = {};
});

function signedIn(id = USER) {
  mockGetUser.mockResolvedValue({ data: { user: { id } } });
}

/** A membership row as the embed returns it. */
function member(
  fields: Partial<{
    role: string;
    functions: string[];
    scope: string;
    cap_grants: string[];
    cap_revokes: string[];
  }> = {},
  org: { kind?: string; deleted_at?: string | null } = {},
) {
  return {
    role: 'member',
    functions: [],
    scope: 'org',
    cap_grants: [],
    cap_revokes: [],
    ...fields,
    organizations: { kind: org.kind ?? 'label', deleted_at: org.deleted_at ?? null },
  };
}

/** Membership answers keyed by org id, so cross-org cases are explicit. */
function memberships(byOrg: Record<string, ReturnType<typeof member> | null>) {
  answers.org_members = (filters) => ({ data: byOrg[String(filters.org_id)] ?? null, error: null });
}

async function load() {
  return import('./org-access');
}

describe('requireOrgMember', () => {
  it('returns 401 when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it('returns 403 for a malformed org id without querying', async () => {
    signedIn();
    const { requireOrgMember } = await load();
    const r = await requireOrgMember('not-a-uuid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('returns 403 when the caller is not a member (or the org does not exist)', async () => {
    signedIn();
    memberships({});
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.res.status).toBe(403);
      expect((await r.res.json()).error).toMatch(/forbidden/i);
    }
  });

  it('reads membership live for THIS user in THIS org', async () => {
    signedIn();
    memberships({ [ORG_A]: member() });
    const { requireOrgMember } = await load();
    await requireOrgMember(ORG_A);
    const eqs = calls.filter((c) => c.table === 'org_members' && c.op === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['org_id', ORG_A]);
    expect(eqs).toContainEqual(['user_id', USER]);
  });

  it('returns 403 for a member of a soft-deleted org', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ role: 'owner' }, { deleted_at: '2026-09-01T00:00:00Z' }) });
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('returns 500 when the membership read errors', async () => {
    signedIn();
    answers.org_members = { data: null, error: { message: 'db down' } };
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(500);
  });

  it('returns the member context with capabilities from the live row', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['marketing'] }) });
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.userId).toBe(USER);
      expect(r.orgId).toBe(ORG_A);
      expect(r.orgKind).toBe('label');
      expect(r.role).toBe('member');
      expect(r.scope).toBe('org');
      expect(r.admin).toBeDefined();
      expect(r.capabilities.has('catalog.read')).toBe(true);
      expect(r.capabilities.has('audio.working')).toBe(false);
    }
  });

  it('accepts the embedded org as a one-element array too', async () => {
    signedIn();
    const row = { ...member({ role: 'owner' }), organizations: [{ kind: 'producer', deleted_at: null }] };
    answers.org_members = { data: row, error: null };
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.orgKind).toBe('producer');
  });

  it('fails closed when the embedded org is missing', async () => {
    signedIn();
    answers.org_members = { data: { ...member(), organizations: null }, error: null };
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });
});

describe('requireOrgCapability', () => {
  it('returns 401 when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { requireOrgCapability } = await load();
    const r = await requireOrgCapability(ORG_A, 'catalog.read');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it('returns 403 for a non-member', async () => {
    signedIn();
    memberships({ [ORG_B]: member({ role: 'owner' }) });
    const { requireOrgCapability } = await load();
    const r = await requireOrgCapability(ORG_A, 'catalog.read');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('returns 403 when the member lacks the capability', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['marketing'] }) });
    const { requireOrgCapability } = await load();
    const r = await requireOrgCapability(ORG_A, 'contracts.read');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('honours a per-member revoke (revoke beats the preset)', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['legal'], cap_revokes: ['contracts.read'] }) });
    const { requireOrgCapability } = await load();
    const r = await requireOrgCapability(ORG_A, 'contracts.read');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('honours a per-member grant', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['marketing'], cap_grants: ['audio.working'] }) });
    const { requireOrgCapability } = await load();
    const r = await requireOrgCapability(ORG_A, 'audio.working');
    expect(r.ok).toBe(true);
  });

  it('never lets a roster artist hold contracts.read, even by grant', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'artists', cap_grants: ['contracts.read'] }) });
    const { requireOrgCapability } = await load();
    const r = await requireOrgCapability(ORG_A, 'contracts.read');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('rejects an unknown capability string', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ role: 'owner' }) });
    const { requireOrgCapability } = await load();
    // A capability arriving from outside the type system grants nothing.
    const r = await requireOrgCapability(ORG_A, 'everything' as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('grants a member who holds it', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['a_and_r'] }) });
    const { requireOrgCapability } = await load();
    const r = await requireOrgCapability(ORG_A, 'release.approve.master');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.orgId).toBe(ORG_A);
  });
});

describe('requireObjectAccess', () => {
  it('returns 401 when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it('returns 404 for a malformed id without querying', async () => {
    signedIn();
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: '1,2', cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('returns 404 when the row does not exist', async () => {
    signedIn();
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('returns 500 when the row read errors', async () => {
    signedIn();
    answers.projects = { data: null, error: { message: 'db down' } };
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(500);
  });

  it('returns 404 for a producer row (org_id IS NULL), even to an org owner', async () => {
    signedIn();
    answers.projects = { data: { org_id: null, id: ROW }, error: null };
    memberships({ [ORG_A]: member({ role: 'owner' }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('never returns 200 for a row in an org the caller is not in', async () => {
    signedIn();
    answers.projects = { data: { org_id: ORG_B, id: ROW }, error: null };
    memberships({ [ORG_A]: member({ role: 'owner' }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
    // Membership was checked against the ROW's org, not anything the caller said.
    const eqs = calls.filter((c) => c.table === 'org_members' && c.op === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['org_id', ORG_B]);
  });

  it('returns 404 when the row is in another org than the route names, even if the caller is in both', async () => {
    signedIn();
    answers.projects = { data: { org_id: ORG_B, id: ROW }, error: null };
    memberships({ [ORG_A]: member({ role: 'owner' }), [ORG_B]: member({ role: 'owner' }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read', orgId: ORG_A });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('matches the route org id case-insensitively (uuids are)', async () => {
    signedIn();
    answers.projects = { data: { org_id: ORG_A, id: ROW }, error: null };
    memberships({ [ORG_A]: member({ role: 'owner' }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read', orgId: ORG_A.toUpperCase() });
    expect(r.ok).toBe(true);
  });

  it('returns 403 when the member lacks the capability', async () => {
    signedIn();
    answers.project_assets = { data: { org_id: ORG_A, project_id: PROJECT }, error: null };
    memberships({ [ORG_A]: member({ functions: ['marketing'] }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'project_assets', id: ROW, cap: 'contracts.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('grants a member with the capability and returns the scope keys', async () => {
    signedIn();
    answers.activity_events = {
      data: { org_id: ORG_A, artist_id: CONTACT, project_id: PROJECT },
      error: null,
    };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'] }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'activity_events', id: ROW, cap: 'catalog.read', orgId: ORG_A });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.orgId).toBe(ORG_A);
      expect(r.object).toEqual({ table: 'activity_events', id: ROW, orgId: ORG_A, contactId: CONTACT, projectId: PROJECT });
    }
  });

  it('selects only the scope columns the table has', async () => {
    signedIn();
    answers.projects = { data: { org_id: ORG_A, id: ROW }, error: null };
    memberships({ [ORG_A]: member({ role: 'owner' }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read' });
    const select = calls.find((c) => c.table === 'projects' && c.op === 'select');
    expect(select?.args[0]).toBe('org_id, id, inbox_for_contact_id');
    expect(r.ok).toBe(true);
    // A project is its own project scope.
    if (r.ok) expect(r.object.projectId).toBe(ROW);
  });

  it('does not treat a portal commenter as the artist scope of a comment', async () => {
    signedIn();
    // project_comments.contact_id is the artist who WROTE a portal comment,
    // not the roster artist the comment belongs to (17 R5).
    answers.project_comments = { data: { org_id: ORG_A, project_id: PROJECT }, error: null };
    memberships({ [ORG_A]: member({ role: 'owner' }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'project_comments', id: ROW, cap: 'catalog.read' });
    const select = calls.find((c) => c.table === 'project_comments' && c.op === 'select');
    expect(select?.args[0]).toBe('org_id, project_id');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.object.contactId).toBeNull();
  });

});

describe('artist scope (LABEL-10)', () => {
  const OTHER_CONTACT = '00000000-0000-4000-8000-0000000000c2';

  function scoped(contactIds: string[]) {
    answers.member_artist_scopes = (filters) => {
      // Read for THIS member of THIS org only.
      expect(filters).toEqual({ org_id: ORG_A, user_id: USER });
      return { data: contactIds.map((contact_id) => ({ contact_id })), error: null };
    };
  }

  it('a scoped member reaches a contact in their scope, and the context carries the scope', async () => {
    signedIn();
    answers.contacts = { data: { org_id: ORG_A, id: CONTACT }, error: null };
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'artists' }) });
    scoped([CONTACT.toUpperCase()]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'contacts', id: CONTACT, cap: 'catalog.read', orgId: ORG_A });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.artistScope).toEqual(new Set([CONTACT]));
  });

  it('an out-of-scope contact is 404, never 403', async () => {
    signedIn();
    answers.contacts = { data: { org_id: ORG_A, id: OTHER_CONTACT }, error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'contacts', id: OTHER_CONTACT, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('a scoped member with zero contacts sees nothing', async () => {
    signedIn();
    answers.contacts = { data: { org_id: ORG_A, id: CONTACT }, error: null };
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'artists' }) });
    scoped([]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'contacts', id: CONTACT, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('a project with no artist (no inbox, no linked contact) is 404 to a scoped member', async () => {
    signedIn();
    answers.projects = { data: { org_id: ORG_A, id: ROW, inbox_for_contact_id: null }, error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it("an activity event is scoped by its artist_id (the roster contact)", async () => {
    signedIn();
    answers.activity_events = { data: { org_id: ORG_A, artist_id: CONTACT, project_id: null }, error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    expect((await requireObjectAccess({ table: 'activity_events', id: ROW, cap: 'catalog.read' })).ok).toBe(true);
  });

  it('role artist is scoped even if the column says org', async () => {
    signedIn();
    answers.contacts = { data: { org_id: ORG_A, id: CONTACT }, error: null };
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'org' }) });
    scoped([]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'contacts', id: CONTACT, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
  });

  it('a failed scope read is 500, never the whole org', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    answers.member_artist_scopes = { data: null, error: { message: 'db down' } };
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(500);
  });

  it('an org-scoped member is not narrowed and costs no scope read', async () => {
    signedIn();
    answers.contacts = { data: { org_id: ORG_A, id: CONTACT }, error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'] }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'contacts', id: CONTACT, cap: 'catalog.read' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.artistScope).toBeNull();
    expect(calls.some((c) => c.table === 'member_artist_scopes')).toBe(false);
  });
});

describe('projects, tracks and project-keyed rows reach their artist through projects (LABEL-12)', () => {
  const OTHER_CONTACT = '00000000-0000-4000-8000-0000000000c2';
  const TRACK = '00000000-0000-4000-8000-0000000000e1';
  const P2 = '00000000-0000-4000-8000-0000000000d2';

  function scoped(contactIds: string[]) {
    answers.member_artist_scopes = { data: contactIds.map((contact_id) => ({ contact_id })), error: null };
  }

  /** `projects`: the single-row read by id, or the list read of a track's projects. */
  function projectsTable(single: Record<string, unknown> | null, list: Record<string, unknown>[] = []) {
    answers.projects = (filters) => (filters.id ? { data: single, error: null } : { data: list, error: null });
  }

  it('a scoped member reaches a project linked to one of their artists', async () => {
    signedIn();
    projectsTable({ org_id: ORG_A, id: PROJECT, inbox_for_contact_id: null });
    answers.project_contacts = { data: [{ contact_id: OTHER_CONTACT }, { contact_id: CONTACT.toUpperCase() }], error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    expect((await requireObjectAccess({ table: 'projects', id: PROJECT, cap: 'catalog.read' })).ok).toBe(true);
    expect(calls).toContainEqual({ table: 'project_contacts', op: 'in', args: ['project_id', [PROJECT]] });
  });

  it("a scoped member reaches their artist's Inbox project", async () => {
    signedIn();
    projectsTable({ org_id: ORG_A, id: PROJECT, inbox_for_contact_id: CONTACT });
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    expect((await requireObjectAccess({ table: 'projects', id: PROJECT, cap: 'catalog.read' })).ok).toBe(true);
  });

  it('a project for other artists only is 404', async () => {
    signedIn();
    projectsTable({ org_id: ORG_A, id: PROJECT, inbox_for_contact_id: OTHER_CONTACT });
    answers.project_contacts = { data: [{ contact_id: OTHER_CONTACT }], error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: PROJECT, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it("a track is reached through a project of its own org", async () => {
    signedIn();
    answers.tracks = { data: { org_id: ORG_A }, error: null };
    answers.project_tracks = { data: [{ project_id: PROJECT }, { project_id: P2 }], error: null };
    projectsTable(null, [{ id: PROJECT, inbox_for_contact_id: null }]);
    answers.project_contacts = { data: [{ contact_id: CONTACT }], error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    expect((await requireObjectAccess({ table: 'tracks', id: TRACK, cap: 'catalog.read' })).ok).toBe(true);
    // Only projects of the track's org count (another org's project never scopes it).
    expect(calls).toContainEqual({ table: 'projects', op: 'eq', args: ['org_id', ORG_A] });
    expect(calls).toContainEqual({ table: 'project_contacts', op: 'in', args: ['project_id', [PROJECT]] });
  });

  it('a track in no project of its org is 404 to a scoped member', async () => {
    signedIn();
    answers.tracks = { data: { org_id: ORG_A }, error: null };
    answers.project_tracks = { data: [], error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'tracks', id: TRACK, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('a failed artist lookup is 500, never a pass', async () => {
    signedIn();
    answers.tracks = { data: { org_id: ORG_A }, error: null };
    answers.project_tracks = { data: null, error: { message: 'db down' } };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'tracks', id: TRACK, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(500);
  });

  it("a project file is reached through its project's artists", async () => {
    signedIn();
    answers.project_assets = { data: { org_id: ORG_A, project_id: PROJECT }, error: null };
    projectsTable(null, [{ id: PROJECT, inbox_for_contact_id: null }]);
    answers.project_contacts = { data: [{ contact_id: CONTACT }], error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    expect((await requireObjectAccess({ table: 'project_assets', id: ROW, cap: 'catalog.read' })).ok).toBe(true);
    expect(calls).toContainEqual({ table: 'projects', op: 'eq', args: ['org_id', ORG_A] });
  });

  it("a comment on another artist's project is 404", async () => {
    signedIn();
    answers.project_comments = { data: { org_id: ORG_A, project_id: PROJECT }, error: null };
    projectsTable(null, [{ id: PROJECT, inbox_for_contact_id: OTHER_CONTACT }]);
    answers.project_contacts = { data: [], error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'project_comments', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('a project-keyed row with no project stays 404 to a scoped member', async () => {
    signedIn();
    answers.project_assets = { data: { org_id: ORG_A, project_id: null }, error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'project_assets', id: ROW, cap: 'catalog.read' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('an org-scoped member costs no artist lookup', async () => {
    signedIn();
    answers.tracks = { data: { org_id: ORG_A }, error: null };
    memberships({ [ORG_A]: member({ functions: ['a_and_r'] }) });
    const { requireObjectAccess } = await load();
    expect((await requireObjectAccess({ table: 'tracks', id: TRACK, cap: 'catalog.read' })).ok).toBe(true);
    expect(calls.some((c) => c.table === 'project_tracks' || c.table === 'project_contacts')).toBe(false);
  });

  it('scope before capability: an out-of-scope project is 404 even without the capability', async () => {
    signedIn();
    projectsTable({ org_id: ORG_A, id: PROJECT, inbox_for_contact_id: null });
    answers.project_contacts = { data: [], error: null };
    memberships({ [ORG_A]: member({ functions: ['finance'], scope: 'artists' }) });
    scoped([CONTACT]);
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'projects', id: PROJECT, cap: 'catalog.write' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });
});

describe('scopedOrgQuery', () => {
  it('pre-applies the org filter from the context, never a user filter', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ role: 'owner' }) });
    const { requireOrgMember, scopedOrgQuery } = await load();
    const ctx = await requireOrgMember(ORG_A);
    if (!ctx.ok) throw new Error('expected a member');
    calls = [];
    scopedOrgQuery(ctx.admin, 'projects', ctx, 'id, name');
    expect(calls).toEqual([
      { table: 'projects', op: 'select', args: ['id, name', undefined] },
      { table: 'projects', op: 'eq', args: ['org_id', ORG_A] },
    ]);
  });

  async function scopedCtx(contactIds: string[]) {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['a_and_r'], scope: 'artists' }) });
    answers.member_artist_scopes = { data: contactIds.map((contact_id) => ({ contact_id })), error: null };
    const mod = await load();
    const ctx = await mod.requireOrgMember(ORG_A);
    if (!ctx.ok) throw new Error('expected a member');
    calls = [];
    return { ...mod, ctx };
  }

  it('narrows contacts to the scoped ids', async () => {
    const C2 = '00000000-0000-4000-8000-0000000000c2';
    const { scopedOrgQuery, ctx } = await scopedCtx([C2, CONTACT]);
    scopedOrgQuery(ctx.admin, 'contacts', ctx, 'id');
    expect(calls.slice(1)).toEqual([
      { table: 'contacts', op: 'eq', args: ['org_id', ORG_A] },
      { table: 'contacts', op: 'in', args: ['id', [CONTACT, C2]] },
    ]);
  });

  it('narrows activity_events by artist_id', async () => {
    const { scopedOrgQuery, ctx } = await scopedCtx([CONTACT]);
    scopedOrgQuery(ctx.admin, 'activity_events', ctx, 'id');
    expect(calls).toContainEqual({ table: 'activity_events', op: 'in', args: ['artist_id', [CONTACT]] });
  });

  it('returns nothing for zero contacts, or for an object table without a contact column', async () => {
    const { scopedOrgQuery, ctx } = await scopedCtx([]);
    scopedOrgQuery(ctx.admin, 'contacts', ctx, 'id');
    expect(calls).toContainEqual({ table: 'contacts', op: 'is', args: ['org_id', null] });
    calls = [];
    scopedOrgQuery(ctx.admin, 'projects', { ...ctx, artistScope: new Set([CONTACT]) }, 'id');
    expect(calls).toContainEqual({ table: 'projects', op: 'is', args: ['org_id', null] });
  });

  it('does not artist-scope org-level tables (co-members stay listable)', async () => {
    const { scopedOrgQuery, ctx } = await scopedCtx([]);
    scopedOrgQuery(ctx.admin, 'org_members', ctx, 'user_id');
    expect(calls.map((c) => c.op)).toEqual(['select', 'eq']);
  });
});

describe('membership edge cases', () => {
  it('a member whose functions grant nothing is still a member', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ functions: ['finance'] }) });
    const { requireOrgMember, requireOrgCapability } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capabilities.size).toBe(0);
    const c = await requireOrgCapability(ORG_A, 'catalog.read');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.res.status).toBe(403);
  });

  it('a role the org kind does not offer is not a membership', async () => {
    signedIn();
    // `artist` is a label-org role only (06 §2.4b).
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'artists' }, { kind: 'producer' }) });
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('an artist-role member is always artist-scoped', async () => {
    signedIn();
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'org' }) });
    const { requireOrgMember } = await load();
    const r = await requireOrgMember(ORG_A);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scope).toBe('artists');
  });
});

describe('sessionIdentity', () => {
  it('returns null without a session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { sessionIdentity } = await load();
    expect(await sessionIdentity()).toBeNull();
  });

  it('returns the id and email, and reads no table', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER, email: 'a@b.test' } } });
    const { sessionIdentity } = await load();
    expect(await sessionIdentity()).toEqual({ userId: USER, email: 'a@b.test' });
    expect(calls).toEqual([]);
  });

  it('tolerates a user without an email', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER } } });
    const { sessionIdentity } = await load();
    expect(await sessionIdentity()).toEqual({ userId: USER, email: null });
  });
});

describe('liveMembership', () => {
  it('answers role + capabilities for a live membership, null otherwise (and on errors)', async () => {
    const { liveMembership } = await load();
    const { createServiceClient } = await import('./ownership');
    const admin = createServiceClient();
    memberships({ [ORG_A]: member({ role: 'admin' }), [ORG_B]: member({}, { deleted_at: '2026-01-01T00:00:00Z' }) });
    const m = await liveMembership(admin, ORG_A, USER);
    expect(m?.role).toBe('admin');
    expect(m?.capabilities.has('members.manage')).toBe(true);
    expect(await liveMembership(admin, ORG_B, USER)).toBeNull();
    expect(await liveMembership(admin, 'nope', USER)).toBeNull();
    answers.org_members = { data: null, error: { message: 'boom' } };
    expect(await liveMembership(admin, ORG_A, USER)).toBeNull();
  });
});
