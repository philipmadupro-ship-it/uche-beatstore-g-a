/**
 * POST /api/org/setup (LABEL-48). Session required; the user id comes from
 * the session and the org from the SQL function; one org per account; 503
 * before migration 189.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeAdmin, type Answer } from '@/lib/labelos/mocks/fake-admin';

const USER = '33333333-3333-4333-8333-333333333333';
const ORG = '22222222-2222-4222-8222-222222222222';

let session: { userId: string; email: string | null } | null = null;
let allowed = true;
let rpcAnswer: Answer = { data: null, error: null };
let admin: ReturnType<typeof fakeAdmin>;

vi.mock('@/lib/auth/org-access', () => ({ sessionIdentity: async () => session }));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => admin.client }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => allowed }));

async function post(body: unknown) {
  const { POST } = await import('./route');
  return POST(new NextRequest('https://app.test/api/org/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  session = { userId: USER, email: 'nova@example.com' };
  allowed = true;
  rpcAnswer = { data: { org_id: ORG, slug: 'nova', kind: 'artist', created: true }, error: null };
  admin = fakeAdmin({ answer: () => ({ data: null, error: null }), rpc: () => rpcAnswer });
});

describe('POST /api/org/setup', () => {
  it('signed out is 401 and calls nothing', async () => {
    session = null;
    expect((await post({ face: 'label', name: 'X' })).status).toBe(401);
    expect(admin.rpcs).toEqual([]);
  });

  it('creates an independent artist org from the session user, and records org.created', async () => {
    const res = await post({ face: 'independent', name: '  Nova  ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ org: { id: ORG, slug: 'nova', kind: 'artist' }, home: '/o/nova', created: true });
    expect(admin.rpcs).toEqual([
      { name: 'labelos_setup_org', args: { p_user: USER, p_kind: 'artist', p_name: 'Nova' } },
    ]);
    expect(admin.chains.some((c) => c.table === 'activity_events')).toBe(true);
  });

  it('a label face asks for kind label', async () => {
    rpcAnswer = { data: { org_id: ORG, slug: 'northside', kind: 'label', created: true }, error: null };
    await post({ face: 'label', name: 'Northside' });
    expect(admin.rpcs[0].args.p_kind).toBe('label');
  });

  it('asking again answers the existing org with 200 and no second event', async () => {
    rpcAnswer = { data: { org_id: ORG, slug: 'nova', kind: 'artist', created: false }, error: null };
    const res = await post({ face: 'independent', name: 'Nova' });
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(false);
    expect(admin.chains.some((c) => c.table === 'activity_events')).toBe(false);
  });

  it('refuses a bad face, extra keys (no user or org id from the body) and a blank name', async () => {
    expect((await post({ face: 'producer', name: 'X' })).status).toBe(400);
    expect((await post({ face: 'label', name: 'X', user_id: USER })).status).toBe(400);
    expect((await post({ face: 'label', name: '    ' })).status).toBe(400);
    expect((await post({ face: 'label', name: 'x'.repeat(81) })).status).toBe(400);
    expect(admin.rpcs).toEqual([]);
  });

  it('rate-limited is 429', async () => {
    allowed = false;
    expect((await post({ face: 'label', name: 'X' })).status).toBe(429);
    expect(admin.rpcs).toEqual([]);
  });

  it('before migration 189: 503 naming it', async () => {
    rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const res = await post({ face: 'label', name: 'X' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/189/);
  });

  it('a database error is a 500 without its text', async () => {
    rpcAnswer = { data: null, error: { code: 'XX000', message: 'secret internals' } };
    const res = await post({ face: 'label', name: 'X' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });
});
