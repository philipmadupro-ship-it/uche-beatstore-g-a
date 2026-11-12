/**
 * GET /api/projects/share/[token]/comments — LABEL-22's redaction: a share
 * page's comment JSON never contains an `internal` comment (a team-only note,
 * mig 150), nor a portal thread, whatever the project is. Before 150 the
 * column does not exist and the share page keeps working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const P1 = '40000000-0000-4000-8000-0000000000a1';
const TOKEN = 'sharetoken1234567890';

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true, getAll: () => [], insert: () => null }));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: () => Promise.resolve(true), clientIp: () => '127.0.0.1' }));
vi.mock('@/lib/share/token-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/share/token-access')>();
  return {
    ...actual,
    resolveShareToken: () => Promise.resolve({ kind: 'project_share', row: { id: 's1', token: TOKEN, project_id: P1, role: 'commenter', label: null } }),
    shareAccessFailure: () => Promise.resolve(null),
  };
});

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, project_id: P1, track_id: null, user_id: null, contact_id: null, share_token: TOKEN, author_name: 'Guest', body: `body-${id}`,
  parent_id: null, region_start: null, region_end: null, visibility: 'artist', edited_at: null, deleted_at: null, created_at: `2026-10-01T10:00:0${id}Z`, ...extra,
});

beforeEach(() => {
  db = {
    tables: {
      project_comments: [
        row('1', { body: 'Great drums' }),
        row('2', { body: 'Owner reply', user_id: 'u-owner', share_token: null }),
        row('3', { body: 'INTERNAL: legal has not cleared the sample', visibility: 'internal', share_token: null, user_id: 'u-team' }),
        row('4', { body: 'Portal thread', contact_id: '30000000-0000-4000-8000-0000000000c1' }),
        row('5', { body: 'Deleted', deleted_at: '2026-10-02' }),
        row('6', { body: 'Unknown class', visibility: 'staff' }),
      ],
    },
  };
  mem = memoryAdmin(db);
});

describe('GET /api/projects/share/[token]/comments', () => {
  it('lists the page’s own comments: no internal note, no portal thread, no deleted row, no unknown class', async () => {
    const { GET } = await import('./route');
    const res = await GET(new NextRequest(`http://localhost/api/projects/share/${TOKEN}/comments`), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.comments as { body: string }[]).map((c) => c.body)).toEqual(['Great drums', 'Owner reply']);
    const text = JSON.stringify(body);
    for (const leak of ['INTERNAL', 'legal has not', 'Portal thread', 'Unknown class', 'u-team']) expect(text, leak).not.toContain(leak);
  });

  it('on a database before 128 / 150 the page still lists its comments, one filter at a time', async () => {
    // A stand-in for PostgREST on an old schema: a filter or a column that is not there answers 42703.
    const attempts: string[][] = [];
    const rows = [row('1', { body: 'Great drums' })];
    for (const missing of [['visibility'], ['visibility', 'contact_id']]) {
      attempts.length = 0;
      const stub = {
        from() {
          const used: string[] = [];
          const q = {
            select: () => q,
            eq: (c: string) => { used.push(c); return q; },
            is: (c: string) => { used.push(c); return q; },
            order: () => {
              attempts.push([...used]);
              const bad = used.some((c) => missing.includes(c));
              return Promise.resolve(bad ? { data: null, error: { code: '42703', message: 'column does not exist' } } : { data: rows, error: null });
            },
          };
          return q;
        },
      };
      mem = { client: stub, writes: [] } as unknown as typeof mem;
      const { GET } = await import('./route');
      const res = await GET(new NextRequest(`http://localhost/api/projects/share/${TOKEN}/comments`), { params: Promise.resolve({ token: TOKEN }) });
      expect(res.status, missing.join()).toBe(200);
      expect((await res.json()).comments).toEqual(rows);
      // Each step drops exactly the filter the database could not run, and the first try had them all.
      expect(attempts[0]).toEqual(['project_id', 'deleted_at', 'contact_id', 'visibility']);
      expect(attempts[attempts.length - 1].some((c) => missing.includes(c))).toBe(false);
    }
  });
});
