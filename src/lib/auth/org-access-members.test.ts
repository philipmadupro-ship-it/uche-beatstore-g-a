import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, eqs, opOf, type Answer, type Chain } from '@/lib/labelos/mocks/fake-admin';

/**
 * LABEL-09 additions to org-access: memberRowQuery (the one way an org route
 * addresses a member row), myOrganizations (the switcher) and orgShellFor
 * (the /o/<slug> layout).
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const THEM = '44444444-4444-4444-8444-444444444444';

const mockGetUser = vi.fn();
let answer: (chain: Chain) => Answer = () => ({ data: null, error: null });
let admin = fakeAdmin({ answer: (c) => answer(c) });

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => admin.client,
}));

const { memberRowQuery, myOrganizations, orgShellFor } = await import('./org-access');

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: ME } } });
  answer = () => ({ data: null, error: null });
  admin = fakeAdmin({ answer: (c) => answer(c) });
});

const ctx = (caps: string[]) => ({
  ok: true as const,
  userId: ME,
  admin: admin.client as never,
  orgId: ORG,
  orgKind: 'label' as const,
  role: 'admin' as const,
  scope: 'org' as const,
  artistScope: null,
  capabilities: new Set(caps) as never,
});

describe('memberRowQuery', () => {
  it('reads one row by org AND user', async () => {
    await memberRowQuery(admin.client as never, ctx([]), THEM).select('role').maybeSingle();
    expect(admin.chains[0].table).toBe('org_members');
    expect(eqs(admin.chains[0])).toEqual({ org_id: ORG, user_id: THEM });
  });

  it('writes are org-filtered and need members.manage', async () => {
    const q = memberRowQuery(admin.client as never, ctx(['members.manage']), THEM);
    await q.update({ role: 'member' });
    await q.delete();
    expect(admin.chains.map((c) => [opOf(c, 'update') ? 'update' : 'delete', eqs(c)])).toEqual([
      ['update', { org_id: ORG, user_id: THEM }],
      ['delete', { org_id: ORG, user_id: THEM }],
    ]);
    const without = memberRowQuery(admin.client as never, ctx(['catalog.read']), THEM);
    expect(() => without.update({ role: 'admin' })).toThrow(/members.manage/);
    expect(() => without.delete()).toThrow(/members.manage/);
    expect(admin.chains).toHaveLength(2);
  });

  it('refuses a user id that is not a uuid', () => {
    expect(() => memberRowQuery(admin.client as never, ctx(['members.manage']), 'x')).toThrow(/uuid/);
  });
});

describe('myOrganizations', () => {
  it('401 without a session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const r = await myOrganizations();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it('lists live orgs with a usable role, sorted by name, and says whether the caller is the producer', async () => {
    answer = (c) => {
      if (c.table === 'creator_profiles') return { data: { user_id: ME }, error: null };
      expect(eqs(c)).toEqual({ user_id: ME });
      return {
        data: [
          { role: 'owner', organizations: { id: 'b', name: 'Uche', slug: 'uche', kind: 'producer', deleted_at: null } },
          { role: 'member', organizations: { id: 'a', name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: null } },
          { role: 'member', organizations: { id: 'c', name: 'Gone', slug: 'gone', kind: 'label', deleted_at: '2026-01-01' } },
          { role: 'artist', organizations: { id: 'd', name: 'Odd', slug: 'odd', kind: 'producer', deleted_at: null } },
          { role: 'owner', organizations: { id: 'e', name: 'Weird', slug: 'weird', kind: 'agency', deleted_at: null } },
        ],
        error: null,
      };
    };
    const r = await myOrganizations();
    expect(r).toMatchObject({
      ok: true,
      isProducer: true,
      orgs: [
        { id: 'a', name: 'Night Shift', slug: 'night-shift', kind: 'label', role: 'member' },
        { id: 'b', name: 'Uche', slug: 'uche', kind: 'producer', role: 'owner' },
      ],
    });
  });

  it('500 when the read fails', async () => {
    answer = (c) => (c.table === 'org_members' ? { data: null, error: { message: 'boom' } } : { data: null, error: null });
    const r = await myOrganizations();
    if (r.ok) throw new Error('expected a failure');
    expect(r.res.status).toBe(500);
  });
});

describe('orgShellFor', () => {
  const org = { id: ORG, name: 'Night Shift', slug: 'night-shift', kind: 'label' };
  const membership = { role: 'admin', functions: [], scope: 'org', cap_grants: [], cap_revokes: [], organizations: { kind: 'label', deleted_at: null } };

  it('resolves the org by slug and the caller’s live membership', async () => {
    answer = (c) => {
      if (c.table === 'organizations') return { data: org, error: null };
      if (c.table === 'org_members') return { data: membership, error: null };
      return { data: null, error: null };
    };
    const shell = await orgShellFor('night-shift');
    expect(shell).toMatchObject({ org, role: 'admin', scope: 'org', viewerIsProducer: false });
    expect(shell?.capabilities).toContain('members.manage');
    const orgRead = admin.chains.find((c) => c.table === 'organizations')!;
    expect(eqs(orgRead)).toEqual({ slug: 'night-shift' });
    expect(opOf(orgRead, 'is')?.args).toEqual(['deleted_at', null]);
  });

  it('null for a non-member, a missing org, no session or a malformed slug', async () => {
    answer = (c) => (c.table === 'organizations' ? { data: org, error: null } : { data: null, error: null });
    expect(await orgShellFor('night-shift')).toBeNull();
    answer = () => ({ data: null, error: null });
    expect(await orgShellFor('night-shift')).toBeNull();
    expect(await orgShellFor('Night Shift')).toBeNull();
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await orgShellFor('night-shift')).toBeNull();
  });
});
