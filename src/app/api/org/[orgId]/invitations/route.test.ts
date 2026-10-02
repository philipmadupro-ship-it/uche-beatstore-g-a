/**
 * POST /api/org/[orgId]/invitations and DELETE …/[invitationId] (LABEL-08).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { fakeAdmin, eqs, opOf, type Answer, type Chain } from '@/lib/labelos/mocks/fake-admin';
import { hashInvitationToken } from '@/lib/labelos/invitations';

const ORG = '22222222-2222-4222-8222-222222222222';
const INVITER = '33333333-3333-4333-8333-333333333333';
const INV = '44444444-4444-4444-8444-444444444444';
const C1 = '55555555-5555-4555-8555-555555555555';

let denied: number | null = null;
let orgKind = 'label';
let allowed = true;
let rateCalls = 0;
let pending: unknown[] = [];
let pendingAfterInsert: unknown[] | null = null;
let auditFails = false;
let emailResult: { sent: boolean; reason?: string } = { sent: true };
let revokeRow: { accepted_at: string | null; revoked_at: string | null } | null = null;
let updateReturns: unknown[] = [];
let admin: ReturnType<typeof fakeAdmin>;
const events: unknown[][] = [];
const emails: Record<string, unknown>[] = [];
const logged: unknown[] = [];

const accessOk = () => ({
  ok: true as const,
  userId: INVITER,
  admin: admin.client,
  orgId: ORG,
  orgKind,
  role: 'admin',
  scope: 'org',
  capabilities: new Set(['members.manage']),
});

vi.mock('@/lib/auth/org-access', () => ({
  requireOrgCapability: async (orgId: string, cap: string) => {
    if (denied) return { ok: false, res: NextResponse.json({ error: 'x' }, { status: denied }) };
    expect([orgId, cap]).toEqual([ORG, 'members.manage']);
    return accessOk();
  },
  requireObjectAccess: async (opts: { table: string; id: string; cap: string; orgId: string }) => {
    if (denied) return { ok: false, res: NextResponse.json({ error: 'x' }, { status: denied }) };
    expect(opts).toEqual({ table: 'org_invitations', id: INV, cap: 'members.manage', orgId: ORG });
    return { ...accessOk(), object: { table: 'org_invitations', id: INV, orgId: ORG, contactId: null, projectId: null } };
  },
  scopedOrgQuery: (a: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => unknown } } }, table: string, ctx: { orgId: string }, cols = '*') =>
    a.from(table).select(cols).eq('org_id', ctx.orgId),
}));
vi.mock('@/lib/labelos/activity', () => ({
  recordEvent: async (...args: unknown[]) => {
    if (auditFails) throw new Error('audit event was not recorded');
    events.push(args.slice(1));
    return { ok: true, id: 'e1' };
  },
}));
vi.mock('@/lib/labelos/invitation-email', () => ({
  inviterDisplayName: async () => 'Uche',
  sendInvitationEmail: async (opts: Record<string, unknown>) => {
    emails.push(opts);
    return emailResult;
  },
}));
vi.mock('@/lib/security/rate-limit', () => ({
  rateLimitDurable: async () => {
    rateCalls += 1;
    return allowed;
  },
}));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: (...a: unknown[]) => logged.push(a), warn: (...a: unknown[]) => logged.push(a), error: (...a: unknown[]) => logged.push(a), debug: () => {} }),
}));

function answer(chain: Chain): Answer {
  if (chain.table === 'organizations') return { data: { name: 'Night Shift' }, error: null };
  if (chain.table === 'org_invitations') {
    if (opOf(chain, 'insert')) {
      const row = opOf(chain, 'insert')!.args[0] as Record<string, unknown>;
      return {
        data: { id: INV, email: row.email, role: row.role, functions: row.functions, artist_ids: row.artist_ids, expires_at: row.expires_at, accepted_at: null, revoked_at: null, created_at: 'now' },
        error: null,
      };
    }
    if (opOf(chain, 'update')) return { data: updateReturns, error: null };
    if (opOf(chain, 'delete')) return { data: null, error: null };
    if (opOf(chain, 'maybeSingle')) return { data: revokeRow ? { id: INV, email: 'a@b.test', ...revokeRow } : null, error: null };
    const inserted = admin.chains.some((c) => c.table === 'org_invitations' && opOf(c, 'insert'));
    return { data: inserted && pendingAfterInsert ? pendingAfterInsert : pending, error: null };
  }
  return { data: null, error: null };
}

beforeEach(() => {
  denied = null;
  orgKind = 'label';
  allowed = true;
  rateCalls = 0;
  pending = [];
  pendingAfterInsert = null;
  auditFails = false;
  emailResult = { sent: true };
  revokeRow = { accepted_at: null, revoked_at: null };
  updateReturns = [{ revoked_at: '2026-10-01T00:00:00Z' }];
  events.length = 0;
  emails.length = 0;
  logged.length = 0;
  admin = fakeAdmin({ answer });
});

async function create(body: unknown) {
  const { POST } = await import('./route');
  const res = await POST(new NextRequest(`https://app.test/api/org/${ORG}/invitations`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ orgId: ORG }),
  });
  return { status: res.status, json: await res.json() };
}

async function revoke() {
  const { DELETE } = await import('./[invitationId]/route');
  const res = await DELETE(new NextRequest(`https://app.test/api/org/${ORG}/invitations/${INV}`, { method: 'DELETE' }), {
    params: Promise.resolve({ orgId: ORG, invitationId: INV }),
  });
  return { status: res.status, json: await res.json() };
}

const insertOf = () => opOf(admin.chains.find((c) => c.table === 'org_invitations' && opOf(c, 'insert'))!, 'insert')!.args[0] as Record<string, unknown>;

describe('POST invitations', () => {
  it('passes through the access helper refusal (401/403)', async () => {
    for (const s of [401, 403]) {
      denied = s;
      expect((await create({ email: 'a@b.test', role: 'member' })).status).toBe(s);
    }
    expect(admin.chains).toEqual([]);
  });

  it('creates: normalised email, hashed token, 7-day expiry, email with the join link, audit event', async () => {
    const before = Date.now();
    const r = await create({ email: '  Nova@Example.COM ', role: 'member', functions: ['a_and_r'], contact_ids: [C1] });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      emailSent: true,
      invitation: { id: INV, email: 'nova@example.com', role: 'member', functions: ['a_and_r'], contact_ids: [C1] },
    });

    const row = insertOf();
    expect(row).toMatchObject({ org_id: ORG, email: 'nova@example.com', role: 'member', functions: ['a_and_r'], artist_ids: [C1], invited_by: INVITER });
    expect(row).not.toHaveProperty('token');
    const expires = Date.parse(String(row.expires_at));
    expect(expires - before).toBeGreaterThanOrEqual(7 * 86_400_000 - 1000);
    expect(expires - before).toBeLessThanOrEqual(7 * 86_400_000 + 1000);

    // The emailed link carries the token whose hash was stored.
    const url = String(emails[0].url);
    const token = url.split('/join/')[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.token_hash).toBe(hashInvitationToken(token));
    expect(emails[0]).toMatchObject({ to: 'nova@example.com', orgName: 'Night Shift', inviterName: 'Uche', role: 'member' });

    // …and nowhere else.
    expect(JSON.stringify(r.json)).not.toContain(token);
    expect(JSON.stringify(r.json)).not.toContain(String(row.token_hash));
    expect(JSON.stringify(events)).not.toContain(token);
    expect(JSON.stringify(logged)).not.toContain(token);

    expect(events).toEqual([
      [
        { orgId: ORG, userId: INVITER },
        'invitation.created',
        { type: 'invitation', id: INV },
        { email: 'nova@example.com', role: 'member', functions: ['a_and_r'], contact_ids: [C1], scope: 'artists' },
      ],
    ]);
  });

  it('reads pending invitations scoped to the org', async () => {
    await create({ email: 'a@b.test', role: 'admin' });
    const chain = admin.chains.find((c) => c.table === 'org_invitations' && !opOf(c, 'insert'))!;
    expect(eqs(chain)).toEqual({ org_id: ORG, email: 'a@b.test' });
  });

  it.each([
    ['owner', {}],
    ['artist', { kind: 'producer' }],
    ['member', { functions: ['a_and_r'], kind: 'producer' }],
    ['admin', { functions: ['legal'] }],
    ['wizard', {}],
  ])('400 for role %s %j', async (role, extra: { kind?: string; functions?: string[] }) => {
    if (extra.kind) orgKind = extra.kind;
    const r = await create({ email: 'a@b.test', role, functions: extra.functions ?? [] });
    expect(r.status).toBe(400);
    expect(admin.chains.some((c) => opOf(c, 'insert'))).toBe(false);
  });

  it('400 on a bad email or unknown fields', async () => {
    expect((await create({ email: 'nope', role: 'member' })).status).toBe(400);
    expect((await create({ email: 'a@b.test', role: 'member', token: 'x' })).status).toBe(400);
  });

  it('409 when the address already has a pending invitation, without spending the rate limit', async () => {
    pending = [{ id: INV }];
    const r = await create({ email: 'a@b.test', role: 'member' });
    expect(r).toMatchObject({ status: 409, json: { invitationId: INV } });
    expect(emails).toEqual([]);
    expect(rateCalls).toBe(0);
  });

  it('a 400 does not spend the rate limit either', async () => {
    await create({ email: 'a@b.test', role: 'owner' });
    expect(rateCalls).toBe(0);
  });

  it('loses a race to an older pending invitation: removes its own row, 409, no email, no event', async () => {
    const OLDER = '66666666-6666-4666-8666-666666666666';
    pendingAfterInsert = [{ id: OLDER }, { id: INV }];
    const r = await create({ email: 'a@b.test', role: 'member' });
    expect(r).toMatchObject({ status: 409, json: { invitationId: OLDER } });
    const del = admin.chains.find((c) => c.table === 'org_invitations' && opOf(c, 'delete'))!;
    expect(eqs(del)).toEqual({ org_id: ORG, id: INV });
    expect(emails).toEqual([]);
    expect(events).toEqual([]);
  });

  it('wins the race when it is the oldest', async () => {
    pendingAfterInsert = [{ id: INV }, { id: '66666666-6666-4666-8666-666666666666' }];
    expect((await create({ email: 'a@b.test', role: 'member' })).status).toBe(201);
  });

  it('429 when rate-limited', async () => {
    allowed = false;
    expect((await create({ email: 'a@b.test', role: 'member' })).status).toBe(429);
    expect(emails).toEqual([]);
  });

  it('removes the invitation again when the audit event cannot be written', async () => {
    auditFails = true;
    const r = await create({ email: 'a@b.test', role: 'member' });
    expect(r.status).toBe(500);
    const del = admin.chains.find((c) => c.table === 'org_invitations' && opOf(c, 'delete'))!;
    expect(eqs(del)).toEqual({ org_id: ORG, id: INV });
    expect(emails).toEqual([]);
  });

  it('reports an email that did not go out, without failing', async () => {
    emailResult = { sent: false, reason: 'not_configured' };
    const r = await create({ email: 'a@b.test', role: 'member' });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ emailSent: false, emailError: 'not_configured' });
  });
});

describe('DELETE invitation', () => {
  it('passes through the access helper refusal (404 for another org)', async () => {
    denied = 404;
    expect((await revoke()).status).toBe(404);
  });

  it('revokes a pending invitation once, org-scoped, with an audit event', async () => {
    const r = await revoke();
    expect(r).toEqual({ status: 200, json: { revoked: true, revoked_at: '2026-10-01T00:00:00Z' } });
    const upd = admin.chains.find((c) => opOf(c, 'update'))!;
    expect(eqs(upd)).toEqual({ org_id: ORG, id: INV });
    expect(upd.ops.filter((o) => o.op === 'is').map((o) => o.args)).toEqual([['accepted_at', null], ['revoked_at', null]]);
    expect(events).toEqual([[{ orgId: ORG, userId: INVITER }, 'invitation.revoked', { type: 'invitation', id: INV }, { email: 'a@b.test' }]]);
  });

  it('is idempotent on an already revoked invitation', async () => {
    revokeRow = { accepted_at: null, revoked_at: '2026-09-30T00:00:00Z' };
    const r = await revoke();
    expect(r).toEqual({ status: 200, json: { revoked: true, revoked_at: '2026-09-30T00:00:00Z' } });
    expect(admin.chains.some((c) => opOf(c, 'update'))).toBe(false);
    expect(events).toEqual([]);
  });

  it('undoes the revocation when its audit event cannot be written', async () => {
    auditFails = true;
    const r = await revoke();
    expect(r.status).toBe(500);
    const updates = admin.chains.filter((c) => opOf(c, 'update'));
    expect(updates.map((c) => opOf(c, 'update')!.args[0])).toEqual([{ revoked_at: expect.any(String) }, { revoked_at: null }]);
    expect(eqs(updates[1])).toEqual({ org_id: ORG, id: INV, revoked_at: '2026-10-01T00:00:00Z' });
  });

  it('409 on an accepted invitation', async () => {
    revokeRow = { accepted_at: '2026-09-30T00:00:00Z', revoked_at: null };
    expect((await revoke()).status).toBe(409);
    expect(events).toEqual([]);
  });

  it('409 when an accept wins the race', async () => {
    updateReturns = [];
    let reads = 0;
    admin = fakeAdmin({
      answer: (chain) => {
        if (chain.table === 'org_invitations' && opOf(chain, 'maybeSingle')) {
          reads += 1;
          return { data: { id: INV, email: 'a@b.test', accepted_at: reads > 1 ? 'now' : null, revoked_at: null }, error: null };
        }
        return answer(chain);
      },
    });
    expect((await revoke()).status).toBe(409);
    expect(events).toEqual([]);
  });
});

describe('GET invitations (LABEL-09)', () => {
  it('lists pending invitations of this org, newest first, without token or hash', async () => {
    pending = [{ id: INV, email: 'a@b.test', role: 'member', functions: ['a_and_r'], artist_ids: [], expires_at: 'x', accepted_at: null, revoked_at: null, created_at: 'now' }];
    const { GET } = await import('./route');
    const res = await GET(new NextRequest(`https://app.test/api/org/${ORG}/invitations`), { params: Promise.resolve({ orgId: ORG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations).toEqual([
      { id: INV, email: 'a@b.test', role: 'member', functions: ['a_and_r'], contact_ids: [], expires_at: 'x', accepted_at: null, revoked_at: null, created_at: 'now' },
    ]);
    const chain = admin.chains[0];
    expect(eqs(chain)).toEqual({ org_id: ORG });
    expect(chain.ops.filter((o) => o.op === 'is').map((o) => o.args)).toEqual([['accepted_at', null], ['revoked_at', null]]);
    expect(opOf(chain, 'gt')?.args[0]).toBe('expires_at');
    expect(String(opOf(chain, 'select')?.args[0])).not.toContain('token');
  });

  it('passes through the access helper refusal', async () => {
    denied = 403;
    const { GET } = await import('./route');
    const res = await GET(new NextRequest(`https://app.test/api/org/${ORG}/invitations`), { params: Promise.resolve({ orgId: ORG }) });
    expect(res.status).toBe(403);
  });
});
