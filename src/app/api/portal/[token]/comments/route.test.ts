/**
 * GET /api/portal/[token]/comments and /pulse — LABEL-22's redaction: an
 * `internal` comment (a team-only note, mig 150) is NEVER part of an artist's
 * portal thread, even if a row somehow carried both a `contact_id` and
 * `visibility = 'internal'` (the database CHECK forbids it; this proves the
 * route does not rely on that alone). Before migration 150 the column does
 * not exist and the portal must keep working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const OWNER = '20000000-0000-4000-8000-000000000001';
const C1 = '30000000-0000-4000-8000-0000000000c1';
const P1 = '40000000-0000-4000-8000-0000000000a1';
const TOKEN = 'portaltoken1234567890abcd';

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => mem.client }));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: () => Promise.resolve(true), clientIp: () => '127.0.0.1' }));
vi.mock('@/lib/artist-portal/gate', () => ({
  gatePortal: () => Promise.resolve({ ok: true, portal: { id: 'portal-1', token: TOKEN, user_id: OWNER, contact_id: C1, last_viewed_at: null, previous_viewed_at: null, view_count: 0 } }),
  hashRequestIp: () => 'iphash',
}));
vi.mock('@/lib/artist-portal/membership', () => ({
  portalProjectLinks: () => Promise.resolve([{ project_id: P1, allow_downloads: false, can_comment: true, in_portal: true, created_at: '2026-09-01', last_notified_at: null, role: 'artist' }]),
}));

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, project_id: P1, track_id: null, user_id: null, contact_id: C1, share_token: null, author_name: 'Artist', body: `body-${id}`,
  parent_id: null, region_start: null, region_end: null, visibility: 'artist', deleted_at: null, created_at: `2026-10-01T10:00:0${id}Z`, ...extra,
});

beforeEach(() => {
  db = {
    tables: {
      project_comments: [
        row('1', { body: 'Love the second beat' }),
        row('2', { body: 'Thanks — mixing it now', user_id: OWNER }), // the producer's reply in this thread
        row('3', { body: 'INTERNAL: do not release this', visibility: 'internal' }), // hostile row: contact_id AND internal
        row('4', { body: 'Other artist', contact_id: '30000000-0000-4000-8000-0000000000c2' }),
        row('5', { body: 'Weird visibility value', visibility: 'staff' }),
      ],
      contacts: [{ id: C1, user_id: OWNER, name: 'Nova' }],
      creator_profiles: [{ user_id: OWNER, display_name: 'UCHE' }],
      artist_messages: [],
      contact_track_states: [],
      project_tracks: [],
      projects: [{ id: P1, user_id: OWNER, name: 'EP', cover_url: null }],
      project_assets: [],
    },
  };
  mem = memoryAdmin(db);
});

const params = { params: Promise.resolve({ token: TOKEN }) };
const get = (path: string) => new NextRequest(`http://localhost/api/portal/${TOKEN}${path}`);

describe('portal comments', () => {
  it('lists the artist’s own thread and never an internal row', async () => {
    const { GET } = await import('./route');
    const res = await GET(get('/comments'), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.comments as { body: string }[]).map((c) => c.body)).toEqual(['Love the second beat', 'Thanks — mixing it now']);
    const text = JSON.stringify(body);
    for (const leak of ['INTERNAL', 'do not release', 'Weird visibility', 'visibility', OWNER]) expect(text, leak).not.toContain(leak);
  });

  it('before migration 150 the portal still lists its thread', async () => {
    const attempts: string[][] = [];
    const rows = [row('1', { body: 'Love the second beat' })];
    const stub = {
      from() {
        const used: string[] = [];
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'in', 'eq', 'is']) q[m] = (c: string) => { if (m !== 'select') used.push(c); return q; };
        q.order = () => q;
        q.limit = () => {
          attempts.push([...used]);
          return Promise.resolve(used.includes('visibility') ? { data: null, error: { code: '42703', message: 'column project_comments.visibility does not exist' } } : { data: rows, error: null });
        };
        q.maybeSingle = () => Promise.resolve({ data: null, error: null });
        return q;
      },
    };
    mem = { client: stub, writes: [] } as unknown as typeof mem;
    const { GET } = await import('./route');
    const res = await GET(get('/comments'), params);
    expect(res.status).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toContain('visibility');
    expect(attempts[1]).not.toContain('visibility');
    expect(((await res.json()).comments as unknown[]).length).toBe(1);
  });

  it('the pulse fingerprint ignores internal rows: adding or changing one moves nothing', async () => {
    const { GET } = await import('../pulse/route');
    const first = await (await GET(get('/pulse'), params)).json();
    db.tables.project_comments.push(row('9', { body: 'another internal', visibility: 'internal' }));
    const second = await (await GET(get('/pulse'), params)).json();
    expect(second).toEqual(first);
    db.tables.project_comments.push(row('8', { body: 'a real reply' }));
    const third = await (await GET(get('/pulse'), params)).json();
    expect(third.comments).not.toEqual(first.comments);
  });
});
