/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PATCH /api/share/[token] — the owner's edit of a token share: the new
 * fields (password, recipient kind, selling, track list), the selling rule,
 * and the ownership gate on every track id.
 */
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  user: { id: 'owner-1' } as { id: string } | null,
  existing: { id: 'l1', user_id: 'owner-1', recipient_kind: 'client' } as any,
  grantable: vi.fn(),
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/share/share-owner', () => ({
  projectShareOwnerId: async () => 'owner-1',
  grantableTrackIds: (...a: unknown[]) => mocks.grantable(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }),
}));
vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
  getAll: vi.fn(),
  update: vi.fn(),
  deleteRow: vi.fn(),
  insert: vi.fn(),
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'tracks') {
        return {
          select: () => ({
            in: async (_c: string, ids: string[]) => ({
              data: ids.map((id) => ({ id, title: `T-${id.slice(0, 1)}`, type: 'beat', cover_url: null })),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: mocks.existing, error: null }) }) }),
        update: (fields: Record<string, unknown>) => {
          mocks.writes.push(fields);
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'l1', token: 'tok', track_ids: [], recipient_kind: 'client', sales_enabled: false, password_hash: null, ...fields },
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    },
  }),
}));

import { PATCH } from './route';

const call = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/share/tok', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ token: 'tok' }) },
  );

beforeEach(() => {
  mocks.user = { id: 'owner-1' };
  mocks.existing = { id: 'l1', user_id: 'owner-1', recipient_kind: 'client' };
  mocks.writes.length = 0;
  mocks.grantable.mockReset().mockImplementation(async (_a: unknown, _o: unknown, ids: string[]) => ids);
});

describe('PATCH /api/share/[token]', () => {
  it('sets a bcrypt password and answers password_protected, not the hash', async () => {
    const res = await call({ password: 'hunter2' });
    expect(res.status).toBe(200);
    expect(await bcrypt.compare('hunter2', mocks.writes[0].password_hash as string)).toBe(true);
    const { share } = await res.json();
    expect(share.password_protected).toBe(true);
    expect(share).not.toHaveProperty('password_hash');
  });

  it('clears a password with null and an expiry with 0', async () => {
    const res = await call({ password: null, expires_days: 0 });
    expect(res.status).toBe(200);
    expect(mocks.writes[0]).toMatchObject({ password_hash: null, expires_at: null });
  });

  it('clears selling when the kind leaves client and says so in the response', async () => {
    const res = await call({ recipient_kind: 'rapper' });
    expect(mocks.writes[0]).toMatchObject({ recipient_kind: 'rapper', sales_enabled: false });
    expect((await res.json()).share.sales_enabled).toBe(false);
  });

  it('is 400 for sales_enabled=true on a non-client link', async () => {
    mocks.existing = { ...mocks.existing, recipient_kind: 'friend' };
    const res = await call({ sales_enabled: true });
    expect(res.status).toBe(400);
    expect(mocks.writes).toHaveLength(0);
  });

  it('stores a deduplicated, ordered track list and returns its summaries in that order', async () => {
    const res = await call({ track_ids: [T2, T1, T2, T3] });
    expect(res.status).toBe(200);
    expect(mocks.writes[0].track_ids).toEqual([T2, T1, T3]);
    expect((await res.json()).share.tracks.map((t: any) => t.id)).toEqual([T2, T1, T3]);
  });

  it('is 403 when any id is not the owner’s to grant, and writes nothing', async () => {
    mocks.grantable.mockImplementation(async (_a: unknown, _o: unknown, ids: string[]) => ids.filter((id) => id !== T3));
    const res = await call({ track_ids: [T1, T3] });
    expect(res.status).toBe(403);
    expect(mocks.writes).toHaveLength(0);
  });

  it('is 400 for an empty track list or a malformed id', async () => {
    expect((await call({ track_ids: [] })).status).toBe(400);
    expect((await call({ track_ids: ['not-a-uuid'] })).status).toBe(400);
    expect(mocks.writes).toHaveLength(0);
  });

  it('keeps the owner gate: 401 signed out, 403 for another owner', async () => {
    mocks.user = null;
    expect((await call({ expires_days: 3 })).status).toBe(401);
    mocks.user = { id: 'someone-else' };
    expect((await call({ expires_days: 3 })).status).toBe(403);
    expect(mocks.writes).toHaveLength(0);
  });
});
