/**
 * LABEL-14: an org row carries its uploader's user_id, so the producer's
 * service-role helpers must not treat it as the producer's own row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const ME = '20000000-0000-4000-8000-000000000001';
const ORG = '10000000-0000-4000-8000-000000000001';
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));

import { requireRowOwnership } from './ownership';
import { scopedList } from '@/lib/db';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  db = {
    tables: {
      tracks: [
        { id: 't-mine', user_id: ME, org_id: null, created_at: '2026-01-02' },
        { id: 't-org', user_id: ME, org_id: ORG, created_at: '2026-01-03' },
      ],
      projects: [
        { id: 'p-mine', user_id: ME, org_id: null, created_at: '2026-01-02' },
        { id: 'p-inbox', user_id: ME, org_id: ORG, created_at: '2026-01-03' },
      ],
      playlists: [{ id: 'pl', user_id: ME, created_at: '2026-01-01' }],
    },
  };
  mem = memoryAdmin(db);
});

describe('producer helpers never own an org row (LABEL-14)', () => {
  it('requireRowOwnership: the producer\'s own track / project as before, an org one is 404 even with their user_id', async () => {
    expect((await requireRowOwnership('tracks', 't-mine')).ok).toBe(true);
    expect((await requireRowOwnership('projects', 'p-mine')).ok).toBe(true);
    for (const [table, id] of [['tracks', 't-org'], ['projects', 'p-inbox']] as const) {
      const res = await requireRowOwnership(table, id);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.res.status).toBe(404);
    }
  });

  it('a table without org rows is checked exactly as before', async () => {
    expect((await requireRowOwnership('playlists', 'pl')).ok).toBe(true);
  });

  it('scopedList: the library and project lists leave org rows out', async () => {
    const tracks = (await scopedList<{ id: string }>('tracks', { includeNullOwner: false })) as { id: string }[];
    expect(tracks.map((t) => t.id)).toEqual(['t-mine']);
    const projects = (await scopedList<{ id: string }>('projects', { includeNullOwner: false })) as { id: string }[];
    expect(projects.map((p) => p.id)).toEqual(['p-mine']);
  });
});
