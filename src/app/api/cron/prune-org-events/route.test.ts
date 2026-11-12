import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const ORG = '10000000-0000-4000-8000-00000000000a';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let configured = true;

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => configured }));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const request = (secret?: string) =>
  new NextRequest('http://localhost/api/cron/prune-org-events', { headers: secret ? { authorization: `Bearer ${secret}` } : undefined });

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  configured = true;
  db = {
    tables: {
      activity_events: [
        { id: 'old-plain', org_id: ORG, verb: 'song.created', audit: false, created_at: daysAgo(800) },
        { id: 'old-audit', org_id: ORG, verb: 'member.removed', audit: true, created_at: daysAgo(2000) },
        { id: 'recent', org_id: ORG, verb: 'song.created', audit: false, created_at: daysAgo(10) },
        { id: 'edge-inside', org_id: ORG, verb: 'song.created', audit: false, created_at: daysAgo(700) },
      ],
    },
  };
  mem = memoryAdmin(db);
});

const { GET } = await import('./route');

describe('GET /api/cron/prune-org-events', () => {
  it('rejects a request without the secret, and a server without one', async () => {
    expect((await GET(request())).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request('cron-secret'))).status).toBe(500);
    expect(db.tables.activity_events).toHaveLength(4);
  });

  it('skips quietly without Supabase', async () => {
    configured = false;
    expect(await (await GET(request('cron-secret'))).json()).toEqual({ skipped: 'Supabase not configured' });
    expect(db.tables.activity_events).toHaveLength(4);
  });

  it('prunes everyday events older than 24 months and keeps audit events however old', async () => {
    const res = await GET(request('cron-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 1, more: false });
    expect(db.tables.activity_events.map((e) => e.id).sort()).toEqual(['edge-inside', 'old-audit', 'recent']);
  });

  it('is idempotent', async () => {
    await GET(request('cron-secret'));
    expect(await (await GET(request('cron-secret'))).json()).toMatchObject({ deleted: 0 });
  });

  it('is a no-op where the Label OS tables do not exist yet', async () => {
    mem = { ...mem, client: { from: () => { throw new Error('relation "public.activity_events" does not exist'); }, rpc: mem.client.rpc } } as typeof mem;
    expect(await (await GET(request('cron-secret'))).json()).toEqual({ skipped: 'Label OS migrations are not applied' });
  });
});
