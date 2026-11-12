/**
 * POST /api/org/account/password (doc 25): a team account sets its own
 * password. Only the session's own managed, live account; anyone else 404
 * before the body is read; the flag is cleared and the change recorded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeAdmin } from '@/lib/labelos/mocks/fake-admin';

const ORG = '22222222-2222-4222-8222-222222222222';
const USER = '44444444-4444-4444-8444-444444444444';
const PASSWORD = 'test-secret-pass';

let session: { userId: string; email: string | null } | null;
let managed: { org_id: string; must_change_password: boolean; disabled_at: string | null } | null;
let admin: ReturnType<typeof fakeAdmin>;
const authCalls: unknown[][] = [];
const events: unknown[][] = [];

const SESSION_ID = '55555555-5555-4555-8555-555555555555';
vi.mock('@/lib/auth/org-access', () => ({ sessionIdentity: async () => session, currentSessionId: async () => SESSION_ID }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () =>
    Object.assign(admin.client, {
      auth: {
        admin: {
          updateUserById: async (id: string, attrs: unknown) => {
            authCalls.push([id, attrs]);
            return { error: null };
          },
        },
      },
    }),
}));
vi.mock('@/lib/labelos/activity', () => ({
  recordEvent: async (...args: unknown[]) => {
    events.push(args.slice(1));
    return { ok: true };
  },
}));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true }));

async function post(body: unknown) {
  const { POST } = await import('./route');
  return POST(new NextRequest('https://app.test/api/org/account/password', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  session = { userId: USER, email: 'mia@label.com' };
  managed = { org_id: ORG, must_change_password: true, disabled_at: null };
  authCalls.length = 0;
  events.length = 0;
  admin = fakeAdmin({
    answer: (chain) => (chain.table === 'org_managed_accounts' ? { data: managed, error: null } : { data: null, error: null }),
    rpc: () => ({ data: ORG, error: null }),
  });
});

describe('POST /api/org/account/password', () => {
  it('sets the session user’s own password, clears the flag and records the change without the secret', async () => {
    const res = await post({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(authCalls).toEqual([[USER, { password: PASSWORD }]]);
    // The session making the change is kept; 190 ends the others.
    expect(admin.rpcs).toEqual([{ name: 'labelos_team_account_password_changed', args: { p_user: USER, p_keep_session: SESSION_ID } }]);
    expect(events).toEqual([[{ orgId: ORG, userId: USER }, 'member.password_changed', { type: 'member', id: USER }, {}]]);
    expect(JSON.stringify(events)).not.toContain(PASSWORD);
  });

  it('is 404 for an account no org created, or one switched off — before the body is read', async () => {
    managed = null;
    expect((await post({})).status).toBe(404);
    managed = { org_id: ORG, must_change_password: false, disabled_at: '2026-10-17T00:00:00Z' };
    expect((await post({ password: PASSWORD })).status).toBe(404);
    expect(authCalls).toEqual([]);
  });

  it('is 401 signed out, and refuses a weak password', async () => {
    session = null;
    expect((await post({ password: PASSWORD })).status).toBe(401);
    session = { userId: USER, email: 'mia@label.com' };
    expect((await post({ password: 'short' })).status).toBe(400);
    expect(authCalls).toEqual([]);
  });
});
