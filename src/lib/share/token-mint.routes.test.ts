/**
 * Each route that mints a public token survives a collision on its first
 * insert: it answers 200 with a NEW token, and the URL carries that token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireRowOwnership = vi.fn();
const mockRequireProducer = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
let counter = 0;

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
  requireRowOwnership: (...a: unknown[]) => mockRequireRowOwnership(...a),
  insert: vi.fn(),
  query: vi.fn(),
  createServiceClient: vi.fn(),
  getAll: vi.fn(),
}));
vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: () => mockRequireProducer(),
  requireRowOwnership: (...a: unknown[]) => mockRequireRowOwnership(...a),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://example.test' }));
vi.mock('nanoid', () => ({ nanoid: (n: number) => `${'t'.repeat(n - 2)}${String(++counter).padStart(2, '0')}` }));

const collision = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "project_shares_token_key"',
  details: 'Key (token)=(x) already exists.',
};

/** insert(row).select().single() that fails once with a token collision, then succeeds. */
function flakyInsert() {
  mockInsert.mockImplementationOnce(() => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: collision }) }) }));
  mockInsert.mockImplementation((row: { token: string }) => ({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'row-1', token: row.token }, error: null }) }),
  }));
}

function req(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const ctx = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) };

beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
});

describe.each([
  ['projects', 'projects', () => import('@/app/api/projects/[id]/shares/route')],
  ['tracks', 'tracks', () => import('@/app/api/tracks/[id]/shares/route')],
  ['playlists', 'playlists', () => import('@/app/api/playlists/[id]/shares/route')],
])('POST /api/%s/[id]/shares', (_name, table, load) => {
  it('retries a token collision and returns the new token in share + url', async () => {
    mockRequireRowOwnership.mockResolvedValue({
      ok: true, userId: 'u1',
      admin: { from: () => ({ insert: mockInsert }) },
    });
    flakyInsert();
    const { POST } = await load();
    const res = await POST(req(`http://localhost/api/${table}/x/shares`, {}), ctx);
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const [first, second] = mockInsert.mock.calls.map((c) => c[0].token);
    expect(first).not.toBe(second);
    const json = await res.json();
    expect(json.share.token).toBe(second);
    expect(json.url).toBe(`https://example.test/projects/share/${second}`);
  });
});

describe('POST /api/share', () => {
  it('retries a token collision and returns the new token', async () => {
    const tracks = { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [{ id: 't1' }], error: null }) }) }) };
    mockRequireProducer.mockResolvedValue({
      ok: true, userId: 'u1',
      admin: { from: (t: string) => (t === 'tracks' ? tracks : { insert: mockInsert }) },
    });
    flakyInsert();
    const { POST } = await import('@/app/api/share/route');
    const res = await POST(req('http://localhost/api/share', { track_ids: ['t1'] }));
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const second = mockInsert.mock.calls[1][0].token;
    expect(mockInsert.mock.calls[0][0].token).not.toBe(second);
    const json = await res.json();
    expect(json.token).toBe(second);
    expect(json.url).toBe(`https://example.test/share/${second}`);
  });

  it('answers 500 "Could not create a link" after three collisions', async () => {
    const tracks = { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [{ id: 't1' }], error: null }) }) }) };
    mockRequireProducer.mockResolvedValue({
      ok: true, userId: 'u1',
      admin: { from: (t: string) => (t === 'tracks' ? tracks : { insert: mockInsert }) },
    });
    mockInsert.mockImplementation(() => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: collision }) }) }));
    const { POST } = await import('@/app/api/share/route');
    const res = await POST(req('http://localhost/api/share', { track_ids: ['t1'] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Could not create a link, try again');
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });
});

describe('POST /api/contacts/[id]/portal reissue', () => {
  it('retries a token collision on the rotating UPDATE and returns the new url', async () => {
    const updates: Record<string, unknown>[] = [];
    const chain = (patch: Record<string, unknown>) => {
      updates.push(patch);
      const ok = updates.length > 1;
      const c: Record<string, unknown> = {};
      c.eq = () => c; c.select = () => c;
      c.single = () => Promise.resolve(ok
        ? { data: { id: 'p1', token: patch.token, revoked_at: null, created_at: 'now' }, error: null }
        : { data: null, error: { ...collision, message: 'duplicate key value violates unique constraint "artist_portals_token_key"' } });
      return c;
    };
    const admin = {
      from: (t: string) => {
        if (t === 'artist_portals') {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', token: 'old', revoked_at: null }, error: null }) }) }) }),
            update: (patch: Record<string, unknown>) => { mockUpdate(patch); return chain(patch); },
          };
        }
        return { insert: () => Promise.resolve({ error: null }) };
      },
    };
    mockRequireRowOwnership.mockResolvedValue({ ok: true, userId: 'u1', admin });
    const { POST } = await import('@/app/api/contacts/[id]/portal/route');
    const res = await POST(req('http://localhost/api/contacts/x/portal', { action: 'reissue' }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    const [a, b] = mockUpdate.mock.calls.map((c) => c[0]);
    expect(a.token).toHaveLength(24);
    expect(a.token).not.toBe(b.token);
    expect(b.revoked_at).toBeNull();
    const json = await res.json();
    expect(json.portal.token).toBe(b.token);
    expect(json.portal.url).toBe(`https://example.test/artist/${b.token}`);
  });
});
