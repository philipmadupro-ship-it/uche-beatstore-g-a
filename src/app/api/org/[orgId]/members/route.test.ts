/**
 * GET / PATCH / DELETE /api/org/[orgId]/members (LABEL-09).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { fakeAdmin, eqs, opOf, type Answer, type Chain } from '@/lib/labelos/mocks/fake-admin';

const ORG = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const THEM = '44444444-4444-4444-8444-444444444444';
const OWNER2 = '55555555-5555-4555-8555-555555555555';

type Row = {
  user_id: string;
  role: string;
  functions: string[];
  scope: string;
  cap_grants: string[];
  cap_revokes: string[];
  joined_at: string;
  invited_by: string | null;
};
const row = (over: Partial<Row> = {}): Row => ({
  user_id: THEM,
  role: 'member',
  functions: ['a_and_r'],
  scope: 'org',
  cap_grants: [],
  cap_revokes: [],
  joined_at: '2026-10-01T00:00:00Z',
  invited_by: ME,
  ...over,
});

let denied: number | null = null;
let myRole: 'owner' | 'admin' = 'admin';
let myCaps = ['members.manage'];
let target: Row | null = row();
let owners = 1;
let updateError: { message: string; code?: string } | null = null;
let deleteError: { message: string; code?: string } | null = null;
let auditFails = false;
let admin: ReturnType<typeof fakeAdmin>;
const events: unknown[][] = [];
let capRequested: string | null = null;

const accessOk = () => ({
  ok: true as const,
  userId: ME,
  admin: admin.client,
  orgId: ORG,
  orgKind: 'label',
  role: myRole,
  scope: 'org',
  capabilities: new Set(myCaps),
});

vi.mock('@/lib/auth/org-access', () => {
  const scoped = (a: { from: (t: string) => { select: (c: string, o?: unknown) => { eq: (k: string, v: string) => unknown } } }, table: string, ctx: { orgId: string }, cols = '*', opts?: unknown) =>
    a.from(table).select(cols, opts).eq('org_id', ctx.orgId);
  return {
    requireOrgMember: async (orgId: string) => {
      if (denied) return { ok: false, res: NextResponse.json({ error: 'x' }, { status: denied }) };
      expect(orgId).toBe(ORG);
      capRequested = null;
      return accessOk();
    },
    requireOrgCapability: async (orgId: string, cap: string) => {
      if (denied) return { ok: false, res: NextResponse.json({ error: 'x' }, { status: denied }) };
      expect(orgId).toBe(ORG);
      capRequested = cap;
      if (!myCaps.includes(cap)) return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return accessOk();
    },
    scopedOrgQuery: scoped,
    memberRowQuery: (a: { from: (t: string) => Record<string, (...x: unknown[]) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => unknown } }> }, ctx: { orgId: string; capabilities: Set<string> }, userId: string) => ({
      select: (cols = '*') => a.from('org_members').select(cols).eq('org_id', ctx.orgId).eq('user_id', userId),
      update: (patch: unknown) => {
        if (!ctx.capabilities.has('members.manage')) throw new Error('members.manage');
        return a.from('org_members').update(patch).eq('org_id', ctx.orgId).eq('user_id', userId);
      },
      delete: () => {
        if (!ctx.capabilities.has('members.manage')) throw new Error('members.manage');
        return a.from('org_members').delete().eq('org_id', ctx.orgId).eq('user_id', userId);
      },
    }),
  };
});
vi.mock('@/lib/labelos/activity', () => ({
  recordEvent: async (...args: unknown[]) => {
    if (auditFails) throw new Error('audit event was not recorded');
    events.push(args.slice(1));
    return { ok: true, id: 'e1' };
  },
}));
vi.mock('@/lib/labelos/member-identity', () => ({
  memberIdentities: async (_a: unknown, _org: string, ids: string[]) =>
    new Map(ids.map((id) => [id, { name: id === ME ? 'Uche' : 'Dana', email: id === ME ? 'uche@studio.test' : 'dana@label.test' }])),
}));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

function answer(chain: Chain): Answer {
  if (chain.table !== 'org_members') return { data: null, error: { message: `unexpected ${chain.table}` } };
  const select = opOf(chain, 'select');
  if (opOf(chain, 'update')) {
    if (updateError) return { data: null, error: updateError };
    const patch = opOf(chain, 'update')!.args[0] as Partial<Row>;
    return { data: select ? [{ ...target!, ...patch }] : null, error: null };
  }
  if (opOf(chain, 'delete')) {
    if (deleteError) return { data: null, error: deleteError };
    return { data: target ? [{ user_id: target.user_id }] : [], error: null };
  }
  if (opOf(chain, 'insert')) return { data: null, error: null };
  if ((select?.args[1] as { head?: boolean } | undefined)?.head) {
    expect(eqs(chain)).toEqual({ org_id: ORG, role: 'owner' });
    return { data: null, error: null, count: owners } as Answer;
  }
  if (opOf(chain, 'maybeSingle')) return { data: target, error: null };
  return { data: [row({ user_id: ME, role: 'owner', functions: [] }), row()], error: null };
}

const { GET, PATCH, DELETE } = await import('./route');
const params = { params: Promise.resolve({ orgId: ORG }) };
const patch = (body: unknown) =>
  PATCH(new NextRequest(`http://x/api/org/${ORG}/members`, { method: 'PATCH', body: JSON.stringify(body) }), params);
const del = (userId: string) => DELETE(new NextRequest(`http://x/api/org/${ORG}/members?user_id=${userId}`, { method: 'DELETE' }), params);

beforeEach(() => {
  denied = null;
  myRole = 'admin';
  myCaps = ['members.manage'];
  target = row();
  owners = 1;
  updateError = null;
  deleteError = null;
  auditFails = false;
  events.length = 0;
  capRequested = null;
  admin = fakeAdmin({ answer });
});

describe('GET members', () => {
  it('lists the org’s members, org-scoped, with emails for a manager', async () => {
    const res = await GET(new NextRequest('http://x'), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members.map((m: { name: string; email: string; is_you: boolean }) => [m.name, m.email, m.is_you])).toEqual([
      ['Uche', 'uche@studio.test', true],
      ['Dana', 'dana@label.test', false],
    ]);
    expect(eqs(admin.chains[0])).toEqual({ org_id: ORG });
    expect(JSON.stringify(body)).not.toContain('invited_by');
  });

  it('any member reads it, but without emails', async () => {
    myCaps = ['catalog.read'];
    const body = await (await GET(new NextRequest('http://x'), params)).json();
    expect(body.members.every((m: { email: unknown }) => m.email === null)).toBe(true);
  });

  it('passes the helper’s refusal through', async () => {
    denied = 403;
    expect((await GET(new NextRequest('http://x'), params)).status).toBe(403);
  });
});

describe('PATCH members', () => {
  it('an admin changes a member’s functions: one update by (org, user), one audit event', async () => {
    const res = await patch({ user_id: THEM, functions: ['marketing'] });
    expect(res.status).toBe(200);
    expect((await res.json()).member).toMatchObject({ user_id: THEM, functions: ['marketing'] });
    expect(capRequested).toBe('members.manage');
    const update = admin.chains.find((c) => opOf(c, 'update'))!;
    expect(opOf(update, 'update')!.args[0]).toEqual({ functions: ['marketing'] });
    expect(eqs(update)).toEqual({ org_id: ORG, user_id: THEM });
    expect(events).toEqual([
      [
        { orgId: ORG, userId: ME },
        'member.capabilities_changed',
        { type: 'member', id: THEM },
        { functions: { from: ['a_and_r'], to: ['marketing'] } },
      ],
    ]);
  });

  it('a role change is ONE member.role_changed event', async () => {
    await patch({ user_id: THEM, role: 'admin' });
    expect(events.map((e) => e[1])).toEqual(['member.role_changed']);
    expect(events[0][3]).toEqual({ role: { from: 'member', to: 'admin' }, functions: { from: ['a_and_r'], to: [] } });
  });

  it('another CHECK violation is a 500, not a misleading last-owner 409', async () => {
    updateError = { code: '23514', message: 'new row violates check constraint "org_members_artist_is_scoped"' };
    expect((await patch({ user_id: THEM, role: 'admin' })).status).toBe(500);
  });

  it('403 without members.manage, before reading anything', async () => {
    myCaps = ['catalog.read'];
    expect((await patch({ user_id: THEM, functions: [] })).status).toBe(403);
    expect(admin.chains).toHaveLength(0);
  });

  it('400 for what the kind does not offer, an owner role or an empty body', async () => {
    expect((await patch({ user_id: THEM, functions: ['dj'] })).status).toBe(400);
    expect((await patch({ user_id: THEM, role: 'owner' })).status).toBe(400);
    expect((await patch({ user_id: THEM, cap_grants: ['members.manage'] })).status).toBe(400);
    expect((await patch({ user_id: THEM })).status).toBe(400);
    expect((await patch({ user_id: 'nope', role: 'admin' })).status).toBe(400);
    expect(admin.chains.some((c) => opOf(c, 'update'))).toBe(false);
  });

  it('404 for someone who is not a member of this org', async () => {
    target = null;
    expect((await patch({ user_id: THEM, role: 'admin' })).status).toBe(404);
  });

  it('an admin cannot touch an owner (403); the last owner cannot be demoted (409)', async () => {
    target = row({ user_id: OWNER2, role: 'owner', functions: [] });
    expect((await patch({ user_id: OWNER2, role: 'admin' })).status).toBe(403);
    myRole = 'owner';
    owners = 1;
    const last = await patch({ user_id: OWNER2, role: 'admin' });
    expect(last.status).toBe(409);
    expect((await last.json()).error).toMatch(/at least one owner/);
    expect(admin.chains.some((c) => opOf(c, 'update'))).toBe(false);
  });

  it('a race the trigger catches is 409, not a raw database error', async () => {
    myRole = 'owner';
    owners = 2;
    target = row({ user_id: OWNER2, role: 'owner', functions: [] });
    updateError = { code: '23514', message: 'organization x must keep at least one owner' };
    // (matched on the trigger's message)
    const res = await patch({ user_id: OWNER2, role: 'admin' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain('23514');
  });

  it('an admin may lower their own role but not make themselves owner', async () => {
    // Raising is refused by planMemberChange's rank rule (members.test.ts);
    // the only role above admin is owner, which is never assigned here.
    target = row({ user_id: ME, role: 'admin', functions: [] });
    expect((await patch({ user_id: ME, role: 'owner' })).status).toBe(400);
    expect((await patch({ user_id: ME, role: 'member' })).status).toBe(200);
  });

  it('an unchanged value writes nothing', async () => {
    const res = await patch({ user_id: THEM, functions: ['a_and_r'] });
    expect(res.status).toBe(200);
    expect(admin.chains.some((c) => opOf(c, 'update'))).toBe(false);
    expect(events).toEqual([]);
  });

  it('when the audit event cannot be written, the change is undone and the request fails', async () => {
    auditFails = true;
    const res = await patch({ user_id: THEM, functions: ['marketing'] });
    expect(res.status).toBe(500);
    const updates = admin.chains.filter((c) => opOf(c, 'update'));
    expect(updates.map((c) => opOf(c, 'update')!.args[0])).toEqual([{ functions: ['marketing'] }, { functions: ['a_and_r'] }]);
    expect(eqs(updates[1])).toEqual({ org_id: ORG, user_id: THEM });
  });
});

describe('DELETE members', () => {
  it('removes a member by (org, user) and records member.removed', async () => {
    const res = await del(THEM);
    expect(res.status).toBe(200);
    const d = admin.chains.find((c) => opOf(c, 'delete'))!;
    expect(eqs(d)).toEqual({ org_id: ORG, user_id: THEM });
    expect(events.map((e) => [e[1], e[3]])).toEqual([['member.removed', { role: 'member', functions: ['a_and_r'], scope: 'org' }]]);
  });

  it('400 without a uuid; 404 when not a member; 403 without members.manage', async () => {
    expect((await del('x')).status).toBe(400);
    target = null;
    expect((await del(THEM)).status).toBe(404);
    myCaps = [];
    expect((await del(THEM)).status).toBe(403);
  });

  it('the last owner is never removed (409), by check or by trigger', async () => {
    myRole = 'owner';
    target = row({ user_id: ME, role: 'owner', functions: [] });
    owners = 1;
    expect((await del(ME)).status).toBe(409);
    owners = 2;
    deleteError = { code: '23514', message: 'must keep at least one owner' };
    expect((await del(ME)).status).toBe(409);
  });

  it('an admin cannot remove an owner', async () => {
    target = row({ user_id: OWNER2, role: 'owner', functions: [] });
    owners = 2;
    expect((await del(OWNER2)).status).toBe(403);
  });

  it('when member.removed cannot be written, the membership is restored', async () => {
    auditFails = true;
    expect((await del(THEM)).status).toBe(500);
    const restore = admin.chains.find((c) => opOf(c, 'insert'))!;
    expect(opOf(restore, 'insert')!.args[0]).toEqual({ org_id: ORG, ...row() });
  });
});
