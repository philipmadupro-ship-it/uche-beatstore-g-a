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
    maybeSingle: async () => {
      const a = answers[table];
      if (!a) return { data: null, error: null };
      return typeof a === 'function' ? a(filters) : a;
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
    expect(select?.args[0]).toBe('org_id, id');
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

  it('artist scope is a no-op until LABEL-10: an artist-scoped member is not narrowed yet', async () => {
    signedIn();
    answers.contacts = { data: { org_id: ORG_A, id: CONTACT }, error: null };
    memberships({ [ORG_A]: member({ role: 'artist', scope: 'artists' }) });
    const { requireObjectAccess } = await load();
    const r = await requireObjectAccess({ table: 'contacts', id: CONTACT, cap: 'catalog.read' });
    // LABEL-10 makes this depend on member_artist_scopes; change this test then.
    expect(r.ok).toBe(true);
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

describe('isLiveOrgMember', () => {
  it('is true for a live membership, false otherwise (and on errors)', async () => {
    const { isLiveOrgMember } = await load();
    const { createServiceClient } = await import('./ownership');
    const admin = createServiceClient();
    memberships({ [ORG_A]: member(), [ORG_B]: member({}, { deleted_at: '2026-01-01T00:00:00Z' }) });
    expect(await isLiveOrgMember(admin, ORG_A, USER)).toBe(true);
    expect(await isLiveOrgMember(admin, ORG_B, USER)).toBe(false);
    expect(await isLiveOrgMember(admin, 'nope', USER)).toBe(false);
    answers.org_members = { data: null, error: { message: 'boom' } };
    expect(await isLiveOrgMember(admin, ORG_A, USER)).toBe(false);
  });
});
