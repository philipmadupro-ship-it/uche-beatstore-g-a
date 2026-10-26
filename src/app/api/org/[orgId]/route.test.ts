/**
 * PATCH /api/org/[orgId] { name } (LABEL-09, carried from LABEL-07).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { fakeAdmin, eqs, opOf, type Answer, type Chain } from '@/lib/labelos/mocks/fake-admin';

const ORG = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';

let caps = ['org.manage'];
let current: { id: string; name: string; slug: string; kind: string } | null = null;
let auditFails = false;
let admin: ReturnType<typeof fakeAdmin>;
const events: unknown[][] = [];

vi.mock('@/lib/auth/org-access', () => ({
  requireOrgCapability: async (orgId: string, cap: string) => {
    expect(orgId).toBe(ORG);
    if (!caps.includes(cap)) return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    return { ok: true, userId: ME, admin: admin.client, orgId: ORG, orgKind: 'producer', role: 'owner', scope: 'org', capabilities: new Set(caps) };
  },
}));
vi.mock('@/lib/labelos/activity', () => ({
  recordEvent: async (...args: unknown[]) => {
    if (auditFails) throw new Error('audit');
    events.push(args.slice(1));
    return { ok: true, id: 'e' };
  },
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function answer(chain: Chain): Answer {
  expect(chain.table).toBe('organizations');
  expect(eqs(chain).id).toBe(ORG);
  const upd = opOf(chain, 'update');
  if (upd) return { data: current ? [{ ...current, ...(upd.args[0] as object) }] : [], error: null };
  return { data: current, error: null };
}

const { PATCH } = await import('./route');
const call = (body: unknown) =>
  PATCH(new NextRequest(`http://x/api/org/${ORG}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ orgId: ORG }) });

beforeEach(() => {
  caps = ['org.manage'];
  current = { id: ORG, name: 'My studio', slug: 'uche', kind: 'producer' };
  auditFails = false;
  events.length = 0;
  admin = fakeAdmin({ answer });
});

describe('PATCH /api/org/[orgId]', () => {
  it('renames the org (name only, slug kept) and records org.settings_changed as audit', async () => {
    const res = await call({ name: '  Uche   Studio ' });
    expect(res.status).toBe(200);
    expect((await res.json()).org).toEqual({ id: ORG, name: 'Uche Studio', slug: 'uche', kind: 'producer' });
    const update = admin.chains.find((c) => opOf(c, 'update'))!;
    expect(opOf(update, 'update')!.args[0]).toEqual({ name: 'Uche Studio' });
    expect(events).toEqual([
      [{ orgId: ORG, userId: ME }, 'org.settings_changed', { type: 'org', id: ORG }, { name: { from: 'My studio', to: 'Uche Studio' } }, { audit: true }],
    ]);
  });

  it('refuses anything but a name, and needs org.manage', async () => {
    expect((await call({ name: '' })).status).toBe(400);
    expect((await call({ name: 'x', slug: 'y' })).status).toBe(400);
    caps = ['members.manage'];
    expect((await call({ name: 'x' })).status).toBe(403);
    expect(admin.chains).toHaveLength(0);
  });

  it('the same name writes nothing; a gone org is 404', async () => {
    expect((await call({ name: 'My studio' })).status).toBe(200);
    expect(admin.chains.some((c) => opOf(c, 'update'))).toBe(false);
    current = null;
    expect((await call({ name: 'New' })).status).toBe(404);
  });

  it('puts the old name back when the audit event cannot be written', async () => {
    auditFails = true;
    expect((await call({ name: 'New' })).status).toBe(500);
    const updates = admin.chains.filter((c) => opOf(c, 'update')).map((c) => opOf(c, 'update')!.args[0]);
    expect(updates).toEqual([{ name: 'New' }, { name: 'My studio' }]);
  });
});
