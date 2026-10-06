/**
 * POST /api/org/join (LABEL-08). Every path the acceptance criteria name:
 * accept, expired, revoked, mismatched email, reused token — plus accepting
 * twice, the signed-out preview, and that the token never reaches a log, a
 * response or the database in clear.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeAdmin, type Answer, type Chain } from '@/lib/labelos/mocks/fake-admin';
import { hashInvitationToken, newInvitationToken } from '@/lib/labelos/invitations';

const ORG = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

let session: { userId: string; email: string | null } | null = null;
let liveMember = false;
let inviterCanManage = true;
let inviterCanShare = true;
let projectMember = false;
let projectRow: Record<string, unknown> | null = { name: 'Uche × Producer X' };
let allowed = true;
let rpcAnswer: Answer = { data: null, error: null };
let previewRow: Record<string, unknown> | null = null;
let admin: ReturnType<typeof fakeAdmin>;
const logged: unknown[] = [];

const INVITER = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';
vi.mock('@/lib/auth/org-access', () => ({
  sessionIdentity: async () => session,
  liveMembership: async (_admin: unknown, _org: string, user: string) => {
    if (user === INVITER) {
      const caps = new Set<string>([...(inviterCanManage ? ['members.manage'] : []), ...(inviterCanShare ? ['share.external'] : [])]);
      return { role: inviterCanManage ? 'admin' : 'member', capabilities: caps };
    }
    return liveMember ? { role: 'member', capabilities: new Set() } : null;
  },
  liveProjectMembership: async () => (projectMember ? { projectId: PROJECT, role: 'contributor', allowDownloads: false } : null),
}));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => admin.client }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => allowed, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({
    info: (...a: unknown[]) => logged.push(a),
    warn: (...a: unknown[]) => logged.push(a),
    error: (...a: unknown[]) => logged.push(a),
    debug: (...a: unknown[]) => logged.push(a),
  }),
}));

function answer(chain: Chain): Answer {
  if (chain.table === 'org_invitations') return { data: previewRow, error: null };
  if (chain.table === 'organizations') return { data: { name: 'Night Shift', slug: 'night-shift', kind: 'label' }, error: null };
  if (chain.table === 'projects') return { data: projectRow, error: null };
  return { data: null, error: null };
}

beforeEach(() => {
  session = null;
  liveMember = false;
  inviterCanManage = true;
  inviterCanShare = true;
  projectMember = false;
  projectRow = { name: 'Uche × Producer X' };
  allowed = true;
  rpcAnswer = { data: null, error: null };
  previewRow = null;
  logged.length = 0;
  admin = fakeAdmin({ answer, rpc: () => rpcAnswer });
});

async function post(body: unknown) {
  const { POST } = await import('./route');
  const res = await POST(new NextRequest('https://app.test/api/org/join', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

const { token } = newInvitationToken();

describe('accept', () => {
  beforeEach(() => {
    session = { userId: USER, email: 'Invitee@Local.Test' };
  });

  it('401 without a session, before touching the database', async () => {
    session = null;
    const r = await post({ token, action: 'accept' });
    expect(r.status).toBe(401);
    expect(admin.rpcs).toEqual([]);
  });

  it('defaults to accept', async () => {
    rpcAnswer = { data: { status: 'joined', org_id: ORG }, error: null };
    const r = await post({ token });
    expect(r.status).toBe(200);
  });

  it('joins: the function gets only the hash and the session user', async () => {
    rpcAnswer = { data: { status: 'joined', org_id: ORG }, error: null };
    const r = await post({ token, action: 'accept' });
    expect(r).toEqual({
      status: 200,
      json: { joined: true, alreadyMember: false, org: { id: ORG, name: 'Night Shift', slug: 'night-shift', kind: 'label' } },
    });
    expect(admin.rpcs).toEqual([
      { name: 'labelos_accept_invitation', args: { p_token_hash: hashInvitationToken(token), p_user: USER } },
    ]);
  });

  it('accepting twice is idempotent', async () => {
    rpcAnswer = { data: { status: 'already_member', org_id: ORG }, error: null };
    const r = await post({ token, action: 'accept' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ joined: true, alreadyMember: true, org: { slug: 'night-shift' } });
  });

  it.each([
    ['expired', 410],
    ['revoked', 410],
    ['used', 409],
    ['not_found', 404],
    ['email_mismatch', 403],
  ])('%s → %i', async (code, status) => {
    rpcAnswer = { data: { error: code }, error: null };
    const r = await post({ token, action: 'accept' });
    expect(r.status).toBe(status);
    expect(r.json.code).toBe(code);
  });

  it('a mismatch never reveals the invited email', async () => {
    rpcAnswer = { data: { error: 'email_mismatch' }, error: null };
    const r = await post({ token, action: 'accept' });
    expect(JSON.stringify(r.json)).not.toMatch(/@/);
  });

  it('a malformed token is 404 without a database call', async () => {
    const r = await post({ token: 'abc', action: 'accept' });
    expect(r.status).toBe(404);
    expect(admin.rpcs).toEqual([]);
  });

  it('503 before migration 138', async () => {
    rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } };
    expect((await post({ token, action: 'accept' })).status).toBe(503);
  });

  it('429 when rate-limited', async () => {
    allowed = false;
    expect((await post({ token, action: 'accept' })).status).toBe(429);
    expect(admin.rpcs).toEqual([]);
  });

  it('400 on an unknown body shape', async () => {
    expect((await post({ token, action: 'accept', role: 'owner' })).status).toBe(400);
    expect((await post({ action: 'accept' })).status).toBe(400);
  });
});

describe('preview', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    org_id: ORG,
    email: 'invitee@local.test',
    role: 'member',
    functions: ['a_and_r'],
    project_id: null,
    invited_by: INVITER,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    accepted_at: null,
    revoked_at: null,
    organizations: { name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: null },
    ...over,
  });

  it('signed out: what the invitation is for, never the email or slug', async () => {
    previewRow = row();
    const r = await post({ token, action: 'preview' });
    expect(r).toEqual({
      status: 200,
      json: {
        org: { name: 'Night Shift', kind: 'label' },
        role: 'member',
        functions: ['a_and_r'],
        state: 'pending',
        signedIn: false,
        emailMatches: null,
        member: false,
      },
    });
    const chain = admin.chains.find((c) => c.table === 'org_invitations')!;
    expect(chain.ops.find((o) => o.op === 'eq')!.args).toEqual(['token_hash', hashInvitationToken(token)]);
  });

  it('signed in with another address: emailMatches false, nothing else', async () => {
    session = { userId: USER, email: 'other@local.test' };
    previewRow = row();
    const r = await post({ token, action: 'preview' });
    expect(r.json).toMatchObject({ signedIn: true, emailMatches: false, member: false });
    expect(JSON.stringify(r.json)).not.toMatch(/invitee/);
  });

  it('signed in as the member it made: the slug, to open the org', async () => {
    session = { userId: USER, email: ' INVITEE@local.test' };
    liveMember = true;
    previewRow = row({ accepted_at: new Date().toISOString() });
    const r = await post({ token, action: 'preview' });
    expect(r.json).toMatchObject({ state: 'accepted', emailMatches: true, member: true, org: { slug: 'night-shift' } });
  });

  it.each([
    ['expired', { expires_at: new Date(Date.now() - 1000).toISOString() }],
    ['revoked', { revoked_at: new Date().toISOString() }],
  ])('reports %s', async (state, over) => {
    previewRow = row(over);
    expect((await post({ token, action: 'preview' })).json.state).toBe(state);
  });

  it('reads as withdrawn when the inviter no longer holds members.manage', async () => {
    inviterCanManage = false;
    previewRow = row();
    expect((await post({ token, action: 'preview' })).json.state).toBe('revoked');
    previewRow = row({ invited_by: null });
    inviterCanManage = true;
    expect((await post({ token, action: 'preview' })).json.state).toBe('revoked');
  });

  it.each([
    ['missing', null],
    ['soft-deleted org', row({ organizations: { name: 'x', slug: 'x', kind: 'label', deleted_at: '2026-01-01' } })],
    ['owner invitation', row({ role: 'owner' })],
  ])('404 for %s', async (_label, r) => {
    previewRow = r;
    expect((await post({ token, action: 'preview' })).status).toBe(404);
  });
});

describe('a project invitation (LABEL-21)', () => {
  const projectInvite = (over: Record<string, unknown> = {}) => ({
    org_id: ORG,
    email: 'guest@local.test',
    role: 'member',
    functions: [],
    project_id: PROJECT,
    project_role: 'contributor',
    project_allow_downloads: false,
    invited_by: INVITER,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    accepted_at: null,
    revoked_at: null,
    organizations: { name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: null },
    ...over,
  });

  it('preview: the project, the role and the org name — never the slug or the address', async () => {
    previewRow = projectInvite();
    const r = await post({ token, action: 'preview' });
    expect(r).toEqual({
      status: 200,
      json: {
        org: { name: 'Night Shift', kind: 'label' },
        project: { name: 'Uche × Producer X', role: 'contributor', allowDownloads: false },
        role: 'contributor',
        functions: [],
        state: 'pending',
        signedIn: false,
        emailMatches: null,
        member: false,
      },
    });
    expect(JSON.stringify(r.json)).not.toMatch(/night-shift|guest@/);
  });

  it('preview: a person already on the project gets where it opens, not the org slug', async () => {
    session = { userId: USER, email: 'guest@local.test' };
    projectMember = true;
    previewRow = projectInvite({ accepted_at: new Date().toISOString() });
    const r = await post({ token, action: 'preview' });
    expect(r.json).toMatchObject({ state: 'accepted', member: true, project: { href: `/shared/${PROJECT}` } });
    expect(JSON.stringify(r.json)).not.toContain('night-shift');
  });

  it('preview: withdrawn when the inviter no longer holds share.external (members.manage is not enough)', async () => {
    inviterCanShare = false;
    previewRow = projectInvite();
    expect((await post({ token, action: 'preview' })).json.state).toBe('revoked');
    inviterCanShare = true;
    inviterCanManage = false;
    expect((await post({ token, action: 'preview' })).json.state).toBe('pending');
  });

  it('preview: 404 when the project is gone', async () => {
    projectRow = null;
    previewRow = projectInvite();
    expect((await post({ token, action: 'preview' })).status).toBe(404);
  });

  it('accept: admitted to the one project; the answer opens it and never names the org slug', async () => {
    session = { userId: USER, email: 'guest@local.test' };
    rpcAnswer = { data: { status: 'joined', org_id: ORG, project_id: PROJECT }, error: null };
    const r = await post({ token, action: 'accept' });
    expect(r).toEqual({
      status: 200,
      json: {
        joined: true,
        alreadyMember: false,
        org: { name: 'Night Shift' },
        project: { id: PROJECT, name: 'Uche × Producer X', href: `/shared/${PROJECT}` },
      },
    });
    expect(JSON.stringify(r.json)).not.toContain('night-shift');
    // Same function, same arguments: the hash and the session user.
    expect(admin.rpcs).toEqual([{ name: 'labelos_accept_invitation', args: { p_token_hash: hashInvitationToken(token), p_user: USER } }]);
  });

  it('accept twice is idempotent', async () => {
    session = { userId: USER, email: 'guest@local.test' };
    rpcAnswer = { data: { status: 'already_member', org_id: ORG, project_id: PROJECT }, error: null };
    const r = await post({ token, action: 'accept' });
    expect(r.json).toMatchObject({ joined: true, alreadyMember: true, project: { href: `/shared/${PROJECT}` } });
  });
});

describe('the token stays secret', () => {
  it('never appears in a response or a log line, on any path', async () => {
    session = { userId: USER, email: 'invitee@local.test' };
    for (const a of [
      { data: { status: 'joined', org_id: ORG }, error: null },
      { data: { error: 'email_mismatch' }, error: null },
      { data: null, error: { message: 'boom' } },
    ] as Answer[]) {
      rpcAnswer = a;
      const r = await post({ token, action: 'accept' });
      expect(JSON.stringify(r.json)).not.toContain(token);
    }
    expect(JSON.stringify(logged)).not.toContain(token);
    expect(JSON.stringify(logged)).not.toContain(hashInvitationToken(token));
  });
});
