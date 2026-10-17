/**
 * Team accounts (doc 25, migration 190): POST /api/org/[orgId]/team-accounts
 * and PATCH …/[userId]. The fake `rpc` stands in for 190's functions; the
 * rules they hold (takeover guards, seat cap, rollback) are proven against
 * Postgres in supabase/local/checks/190_labelos_team_accounts.sql. Here: the
 * route's order of work, that a refused or failed database step leaves no
 * login behind, that an existing account is never touched, and that no
 * password reaches a log, an event or a response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { fakeAdmin, type Answer } from '@/lib/labelos/mocks/fake-admin';

const ORG = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const NEW_USER = '44444444-4444-4444-8444-444444444444';
const C1 = '55555555-5555-4555-8555-555555555555';
const PASSWORD = 'test-secret-pass';

let denied: number | null = null;
let orgKind = 'label';
let rpcAnswers: Record<string, Answer> = {};
let createAnswer: { data: { user: { id: string } | null }; error: { message: string; code?: string } | null };
let updateAnswer: { error: { message: string } | null };
let missingContacts: string[] = [];
let admin: ReturnType<typeof fakeAdmin>;
const authCalls: unknown[][] = [];
const logged: unknown[] = [];

vi.mock('@/lib/auth/org-access', () => ({
  requireOrgCapability: async (orgId: string, cap: string) => {
    if (denied) return { ok: false, res: NextResponse.json({ error: 'x' }, { status: denied }) };
    expect([orgId, cap]).toEqual([ORG, 'members.manage']);
    return { ok: true, userId: ACTOR, admin: client(), orgId: ORG, orgKind, role: 'admin', scope: 'org', capabilities: new Set(['members.manage']) };
  },
}));
vi.mock('@/lib/labelos/org-contacts', () => ({ missingRosterContacts: async () => missingContacts }));
vi.mock('@/lib/labelos/entitlements-store', () => ({ seatsInUse: async () => ({ members: 0, pending: 0 }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({
    info: (...a: unknown[]) => logged.push(a),
    warn: (...a: unknown[]) => logged.push(a),
    error: (...a: unknown[]) => logged.push(a),
    debug: () => {},
  }),
}));

function client() {
  return Object.assign(admin.client, {
    auth: {
      admin: {
        createUser: async (attrs: unknown) => {
          authCalls.push(['createUser', attrs]);
          return createAnswer;
        },
        deleteUser: async (id: string) => {
          authCalls.push(['deleteUser', id]);
          return { error: null };
        },
        updateUserById: async (id: string, attrs: unknown) => {
          authCalls.push(['updateUserById', id, attrs]);
          return updateAnswer;
        },
      },
    },
  });
}

async function create(body: unknown) {
  const { POST } = await import('./route');
  return POST(new NextRequest(`https://app.test/api/org/${ORG}/team-accounts`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), {
    params: Promise.resolve({ orgId: ORG }),
  });
}

async function patch(userId: string, body: unknown) {
  const { PATCH } = await import('./[userId]/route');
  return PATCH(new NextRequest(`https://app.test/api/org/${ORG}/team-accounts/${userId}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), {
    params: Promise.resolve({ orgId: ORG, userId }),
  });
}

const VALID = { email: 'Marketing@Label.com', name: 'Mia', password: PASSWORD, role: 'member', functions: ['marketing'] };

beforeEach(() => {
  denied = null;
  orgKind = 'label';
  missingContacts = [];
  rpcAnswers = {
    labelos_audit_team_account_create: { data: { ok: true }, error: null },
    labelos_audit_team_account_reset: { data: { ok: true }, error: null },
    labelos_audit_team_account_set_disabled: { data: { ok: true }, error: null },
  };
  createAnswer = { data: { user: { id: NEW_USER } }, error: null };
  updateAnswer = { error: null };
  authCalls.length = 0;
  logged.length = 0;
  admin = fakeAdmin({
    answer: () => ({ data: null, error: null }),
    rpc: (name) => rpcAnswers[name] ?? { data: null, error: { message: `no ${name}` } },
  });
});

function noPasswordAnywhere(res: unknown) {
  expect(JSON.stringify(logged)).not.toContain(PASSWORD);
  expect(JSON.stringify(admin.rpcs)).not.toContain(PASSWORD);
  expect(JSON.stringify(res)).not.toContain(PASSWORD);
}

describe('POST team-accounts', () => {
  it('creates the login (email confirmed, lower-cased), then the membership in one function, and names them', async () => {
    const res = await create(VALID);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.member).toMatchObject({ user_id: NEW_USER, email: 'marketing@label.com', role: 'member', functions: ['marketing'], scope: 'org' });
    expect(authCalls[0]).toEqual(['createUser', { email: 'marketing@label.com', password: PASSWORD, email_confirm: true, user_metadata: { name: 'Mia', created_by_org: ORG } }]);
    expect(admin.rpcs).toEqual([
      {
        name: 'labelos_audit_team_account_create',
        args: {
          p_org: ORG,
          p_actor: ACTOR,
          p_user: NEW_USER,
          p_role: 'member',
          p_functions: ['marketing'],
          p_artist_ids: [],
          p_payload: { email: 'marketing@label.com', role: 'member', functions: ['marketing'], contact_ids: [], scope: 'org' },
        },
      },
    ]);
    expect(admin.chains.find((c) => c.table === 'user_profiles')).toBeTruthy();
    noPasswordAnywhere(body);
  });

  it('never creates an owner, and refuses a weak password before any login exists', async () => {
    expect((await create({ ...VALID, role: 'owner' })).status).toBe(400);
    expect((await create({ ...VALID, password: 'short' })).status).toBe(400);
    expect((await create({ ...VALID, password: 'mia-marketing-pw', email: 'marketing@label.com' })).status).toBe(400);
    expect(authCalls).toEqual([]);
  });

  it('an address that already has an account is never touched: 409, invite instead', async () => {
    createAnswer = { data: { user: null }, error: { message: 'A user with this email address has already been registered', code: 'email_exists' } };
    const res = await create(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('email_taken');
    expect(authCalls.map((c) => c[0])).toEqual(['createUser']);
    expect(admin.rpcs).toEqual([]);
  });

  it('a refused membership (seat cap) deletes the login it just made', async () => {
    rpcAnswers.labelos_audit_team_account_create = { data: { error: 'seat_limit' }, error: null };
    const res = await create(VALID);
    expect(res.status).toBe(409);
    expect(authCalls.map((c) => c[0])).toEqual(['createUser', 'deleteUser']);
    expect(authCalls[1]).toEqual(['deleteUser', NEW_USER]);
  });

  it('a failed membership deletes the login too; before 190 it is 503', async () => {
    rpcAnswers.labelos_audit_team_account_create = { data: null, error: { message: 'boom', code: 'XX000' } };
    expect((await create(VALID)).status).toBe(500);
    expect(authCalls.map((c) => c[0])).toEqual(['createUser', 'deleteUser']);
    authCalls.length = 0;
    rpcAnswers.labelos_audit_team_account_create = { data: null, error: { message: 'Could not find the function public.labelos_audit_team_account_create', code: 'PGRST202' } };
    expect((await create(VALID)).status).toBe(503);
    expect(authCalls.map((c) => c[0])).toEqual(['createUser', 'deleteUser']);
  });

  it('artists outside the roster are refused before any login exists', async () => {
    missingContacts = [C1];
    expect((await create({ ...VALID, contact_ids: [C1] })).status).toBe(400);
    expect(authCalls).toEqual([]);
  });

  it('needs members.manage', async () => {
    denied = 403;
    expect((await create(VALID)).status).toBe(403);
    expect(authCalls).toEqual([]);
  });
});

describe('PATCH team-accounts/[userId]', () => {
  it('reset: the audited function first, then the new password', async () => {
    const res = await patch(NEW_USER, { action: 'reset_password', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user_id: NEW_USER, pending_password_change: true });
    expect(admin.rpcs.map((r) => r.name)).toEqual(['labelos_audit_team_account_reset']);
    expect(authCalls).toEqual([['updateUserById', NEW_USER, { password: PASSWORD }]]);
    noPasswordAnywhere(null);
  });

  it('a refused target is never touched: not ours 404, shared 409, owner 403, self 409', async () => {
    for (const [reason, status] of [['not_managed', 404], ['shared', 409], ['owner_only', 403], ['self', 409]] as const) {
      rpcAnswers.labelos_audit_team_account_reset = { data: { error: reason }, error: null };
      expect((await patch(NEW_USER, { action: 'reset_password', password: PASSWORD })).status, reason).toBe(status);
    }
    expect(authCalls).toEqual([]);
  });

  it('switch off bans the login; a failed ban puts the record back', async () => {
    expect((await patch(NEW_USER, { action: 'disable' })).status).toBe(200);
    expect(authCalls).toEqual([['updateUserById', NEW_USER, { ban_duration: '876000h' }]]);
    authCalls.length = 0;
    admin.rpcs.length = 0;
    updateAnswer = { error: { message: 'gotrue down' } };
    expect((await patch(NEW_USER, { action: 'disable' })).status).toBe(502);
    expect(admin.rpcs.map((r) => [r.name, r.args.p_disabled])).toEqual([
      ['labelos_audit_team_account_set_disabled', true],
      ['labelos_audit_team_account_set_disabled', false],
    ]);
  });

  it('switch on lifts the ban', async () => {
    expect((await patch(NEW_USER, { action: 'enable' })).status).toBe(200);
    expect(authCalls).toEqual([['updateUserById', NEW_USER, { ban_duration: 'none' }]]);
  });

  it('refuses a bad id, a bad body and a weak password without touching anything', async () => {
    expect((await patch('not-a-uuid', { action: 'disable' })).status).toBe(404);
    expect((await patch(NEW_USER, { action: 'delete' })).status).toBe(400);
    expect((await patch(NEW_USER, { action: 'reset_password', password: 'short' })).status).toBe(400);
    expect(admin.rpcs).toEqual([]);
    expect(authCalls).toEqual([]);
  });
});
