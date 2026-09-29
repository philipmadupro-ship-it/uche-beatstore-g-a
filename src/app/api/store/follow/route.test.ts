/**
 * A signed-in buyer's follow must persist under their account email. The
 * route used to resolve identity only from the legacy 24h token or a body
 * email (which proved nothing — see the last cases), so a buyer signed in at /store/account/me (no token, or an expired
 * one) got `needsEmail` and the follow stayed in localStorage only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const PRODUCER = '44444444-4444-4444-8444-444444444444';
let sessionUser: { id: string; email: string } | null = null;
const upserts: Row[] = [];
const deletes: Array<Array<[string, unknown]>> = [];
type Row = Record<string, unknown>;

const admin = {
  from: () => {
    const filters: Array<[string, unknown]> = [];
    const q = {
      upsert: async (row: Row) => { upserts.push(row); return { error: null }; },
      delete: () => q,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        if (filters.length === 2) deletes.push(filters);
        return filters.length === 2 ? Promise.resolve({ error: null }) : q;
      },
    };
    return q;
  },
  auth: {
    admin: {
      getUserById: async (id: string) => ({
        data: { user: sessionUser?.id === id ? { id, email: sessionUser.email } : null },
      }),
    },
  },
};

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => admin,
  requireUser: async () =>
    sessionUser
      ? { ok: true, userId: sessionUser.id, admin }
      : { ok: false, res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) },
}));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '1.1.1.1' }));
vi.mock('@/lib/buyer-tokens', () => ({
  verifyBuyerToken: (t: string) => (t === 'live' ? { email: 'token-buyer@example.test', exp: 9_999_999_999 } : null),
}));

function follow(extra: Row = {}) {
  return new NextRequest('http://localhost/api/store/follow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ producer_user_id: PRODUCER, action: 'follow', ...extra }),
  });
}

beforeEach(() => {
  sessionUser = null;
  upserts.length = 0;
  deletes.length = 0;
});

describe('POST /api/store/follow — buyer identity', () => {
  it('a signed-in buyer with no token follows under their canonical account email', async () => {
    sessionUser = { id: 'b1', email: 'Buyer@Example.TEST' };
    const { POST } = await import('./route');
    const body = await (await POST(follow())).json();

    expect(body).toMatchObject({ ok: true, persisted: true });
    expect(upserts).toEqual([{ producer_user_id: PRODUCER, email: 'buyer@example.test' }]);
  });

  it('the session wins over a stale or different legacy token', async () => {
    sessionUser = { id: 'b1', email: 'buyer@example.test' };
    const { POST } = await import('./route');
    await POST(follow({ token: 'live' }));

    expect(upserts[0].email).toBe('buyer@example.test');
  });

  it('unfollow uses the session identity too', async () => {
    sessionUser = { id: 'b1', email: 'buyer@example.test' };
    const { POST } = await import('./route');
    await POST(follow({ action: 'unfollow' }));

    expect(deletes[0]).toContainEqual(['email', 'buyer@example.test']);
  });

  it('signed out: the legacy token still works', async () => {
    const { POST } = await import('./route');
    await POST(follow({ token: 'live' }));

    expect(upserts[0].email).toBe('token-buyer@example.test');
  });

  it('signed out with an expired token: not persisted, asks for sign-in', async () => {
    const { POST } = await import('./route');
    const body = await (await POST(follow({ token: 'expired' }))).json();

    expect(body).toMatchObject({ ok: true, persisted: false, needsSignIn: true });
    expect(upserts).toHaveLength(0);
  });

  it("an email typed into the body cannot follow on a stranger's behalf", async () => {
    const { POST } = await import('./route');
    const body = await (await POST(follow({ email: 'victim@example.test' }))).json();

    expect(body).toMatchObject({ persisted: false });
    expect(upserts).toHaveLength(0);
  });

  it("an email typed into the body cannot unfollow someone else", async () => {
    const { POST } = await import('./route');
    await POST(follow({ action: 'unfollow', email: 'victim@example.test' }));

    expect(deletes).toHaveLength(0);
  });

  it('a signed-in buyer who also sends another email still acts only as themselves', async () => {
    sessionUser = { id: 'b1', email: 'buyer@example.test' };
    const { POST } = await import('./route');
    await POST(follow({ email: 'victim@example.test' }));

    expect(upserts).toEqual([{ producer_user_id: PRODUCER, email: 'buyer@example.test' }]);
  });
});
