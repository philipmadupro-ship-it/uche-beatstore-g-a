/**
 * POST /api/playlists/[id]/tracks adds only the caller's own tracks (review G3).
 *
 * The route checked the playlist's owner and nothing about the tracks, so any
 * producer could put any track id in a playlist of theirs. An org song
 * (ownerless, org_id set) in a FEATURED playlist is then served by the public
 * `/api/store` (title, tempo, key, cover) — which looks the playlist's tracks
 * up by id with no `store_listed` / owner filter — and `GET /api/playlists`
 * shows its cover to the playlist's owner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const ME = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const ORG = '10000000-0000-4000-8000-000000000001';
const PL = '50000000-0000-4000-8000-0000000000a1';
const MINE = '30000000-0000-4000-8000-0000000000a1';
const THEIRS = '30000000-0000-4000-8000-0000000000a2';
const ORG_SONG = '30000000-0000-4000-8000-0000000000b1';

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  db = {
    tables: {
      playlists: [{ id: PL, user_id: ME, name: 'Mine', org_id: null }],
      tracks: [
        { id: MINE, user_id: ME, org_id: null, title: 'mine' },
        { id: THEIRS, user_id: OTHER, org_id: null, title: 'someone else' },
        { id: ORG_SONG, user_id: null, org_id: ORG, title: 'The label’s unreleased single' },
      ],
      playlist_tracks: [],
    },
  };
  mem = memoryAdmin(db);
});

const post = (track_ids: string[]) =>
  new NextRequest(`http://localhost/api/playlists/${PL}/tracks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track_ids }),
  });

describe('POST /api/playlists/[id]/tracks', () => {
  it('adds the caller’s own tracks and skips another user’s and an organization’s', async () => {
    const { POST } = await import('./route');
    const res = await POST(post([MINE, THEIRS, ORG_SONG]), { params: Promise.resolve({ id: PL }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { added: number }).added).toBe(1);
    expect(db.tables.playlist_tracks.map((r) => r.track_id)).toEqual([MINE]);
  });
});
