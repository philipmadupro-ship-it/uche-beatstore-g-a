/**
 * GET /api/org/[orgId]/admin (doc 25, phase 3): the admin centre's numbers.
 * Managers only, label / artist orgs only, counts and names only, and team
 * changes only for a whole-org reader of internal events.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { fakeAdmin, type Chain } from '@/lib/labelos/mocks/fake-admin';

const ORG = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const MIA = '44444444-4444-4444-8444-444444444444';

let denied: number | null;
let orgKind: string;
let scope: 'org' | 'artists';
let caps: string[];
let entitlements: unknown;
let missingTeamAccounts: boolean;
let admin: ReturnType<typeof fakeAdmin>;

vi.mock('@/lib/auth/org-access', () => ({
  requireOrgCapability: async (orgId: string, cap: string) => {
    if (denied) return { ok: false, res: NextResponse.json({ error: 'x' }, { status: denied }) };
    expect([orgId, cap]).toEqual([ORG, 'members.manage']);
    return { ok: true, userId: OWNER, admin: admin.client, orgId: ORG, orgKind, role: 'owner', scope, artistScope: null, capabilities: new Set(caps), entitlements };
  },
}));
vi.mock('@/lib/labelos/entitlements-store', () => ({ seatsInUse: async () => 4 }));
vi.mock('@/lib/labelos/org-contacts', () => ({
  orgContactRoles: async () => [
    { id: 'a', category: 'artist', secondary_category: null },
    { id: 'b', category: 'other', secondary_category: 'artist' },
    { id: 'c', category: 'label', secondary_category: null },
  ],
}));
vi.mock('@/lib/labelos/member-identity', () => ({
  memberIdentities: async (_a: unknown, _o: string, ids: string[]) => new Map(ids.map((id) => [id, { name: id === OWNER ? 'Ada' : 'Mia', email: `${id}@x.test` }])),
  memberLabel: (i: { name: string | null; email: string | null } | undefined) => i?.name ?? i?.email ?? 'Member',
}));

function answer(chain: Chain) {
  switch (chain.table) {
    case 'org_members':
      return { data: [{ role: 'owner' }, { role: 'member' }, { role: 'member' }, { role: 'artist' }], error: null };
    case 'org_managed_accounts':
      return missingTeamAccounts
        ? { data: null, error: { message: 'relation "public.org_managed_accounts" does not exist', code: '42P01' } }
        : { data: [{ must_change_password: true, disabled_at: null }, { must_change_password: false, disabled_at: '2026-10-18T00:00:00Z' }], error: null };
    case 'org_invitations':
      return { data: null, error: null, count: 2 };
    case 'activity_events':
      return {
        data: [
          { id: 'e2', verb: 'member.account_disabled', actor_id: OWNER, subject_type: 'member', subject_id: MIA, created_at: '2026-10-18T10:00:00Z' },
          { id: 'e1', verb: 'invitation.created', actor_id: OWNER, subject_type: 'invitation', subject_id: 'inv-1', created_at: '2026-10-17T10:00:00Z' },
        ],
        error: null,
      };
    default:
      return { data: null, error: { message: `unexpected ${chain.table}` } };
  }
}

async function get() {
  const { GET } = await import('./route');
  return GET(new NextRequest(`https://app.test/api/org/${ORG}/admin`), { params: Promise.resolve({ orgId: ORG }) });
}

beforeEach(() => {
  denied = null;
  orgKind = 'label';
  scope = 'org';
  caps = ['members.manage', 'org.manage', 'catalog.read', 'business.read.internal'];
  entitlements = { modules: new Set(['catalog', 'digest']), maxSeats: 5, maxArtists: null, setupDone: true, licensed: true };
  missingTeamAccounts = false;
  admin = fakeAdmin({ answer });
});

describe('GET /api/org/[orgId]/admin', () => {
  it('answers the team, seats, artists, licence and the last team changes', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.team).toEqual({ members: 4, owners: 1, admins: 0, staff: 2, artistLogins: 1, teamAccounts: 2, mustSetPassword: 1, switchedOff: 1, pendingInvitations: 2 });
    expect(body.seats).toEqual({ used: 4, max: 5 });
    expect(body.artists).toEqual({ count: 2, max: null });
    expect(body.licence).toEqual({ licensed: true, modules: ['catalog', 'digest'] });
    expect(body.recent).toEqual([
      { id: 'e2', verb: 'member.account_disabled', phrase: 'switched off a team account', actor: 'Ada', subject: 'Mia', at: '2026-10-18T10:00:00Z' },
      { id: 'e1', verb: 'invitation.created', phrase: 'invited a member', actor: 'Ada', subject: null, at: '2026-10-17T10:00:00Z' },
    ]);
    // Counts and names only: no email or payload reaches the page.
    expect(JSON.stringify(body)).not.toContain('@x.test');
    const events = admin.chains.find((c) => c.table === 'activity_events')!;
    expect(events.ops.find((o) => o.op === 'select')?.args[0]).not.toContain('payload');
  });

  it('team changes are left out for a manager limited to some artists, or without internal reads', async () => {
    scope = 'artists';
    expect((await (await get()).json()).recent).toBeNull();
    scope = 'org';
    caps = ['members.manage'];
    expect((await (await get()).json()).recent).toBeNull();
    expect(admin.chains.some((c) => c.table === 'activity_events')).toBe(false);
  });

  it('before migration 190 there are simply no team accounts', async () => {
    missingTeamAccounts = true;
    const body = await (await get()).json();
    expect(body.team.teamAccounts).toBe(0);
  });

  it('needs members.manage; a producer org has no admin centre', async () => {
    denied = 403;
    expect((await get()).status).toBe(403);
    denied = null;
    orgKind = 'producer';
    expect((await get()).status).toBe(404);
  });
});
