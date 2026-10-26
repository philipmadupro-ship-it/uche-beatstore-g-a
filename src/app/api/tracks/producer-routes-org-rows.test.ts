/**
 * Producer track routes never reach an ORGANIZATION's rows (review G3).
 *
 * Org tracks are ownerless (user_id NULL, org_id set — migration 142). Three
 * producer routes still read "my tracks" as `user_id = me OR user_id IS NULL`
 * (the arm for pre-ownership producer rows), so every org's songs fell into
 * it: the similar-tracks pool returned org songs (with their stored
 * references) to any producer, the tag vocabulary listed every org's custom
 * tags, and bulk tagging added / removed tags on an org track given its id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const ME = '20000000-0000-4000-8000-000000000001';
const ORG = '10000000-0000-4000-8000-000000000001';
const MINE = '30000000-0000-4000-8000-0000000000a1';
const MINE_2 = '30000000-0000-4000-8000-0000000000a2';
const LEGACY = '30000000-0000-4000-8000-0000000000a3'; // pre-ownership producer row: user_id NULL, no org
const ORG_SONG = '30000000-0000-4000-8000-0000000000b1';

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const track = (id: string, user_id: string | null, org_id: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  user_id,
  org_id,
  title: `title-${id.slice(-2)}`,
  type: 'beat',
  bpm: 140,
  key: 'F',
  scale: 'minor',
  audio_url: `r2://private/${org_id ? `orgs/${org_id}/tracks` : 'masters'}/${id}.wav`,
  ...extra,
});

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  db = {
    tables: {
      tracks: [track(MINE, ME, null), track(MINE_2, ME, null), track(LEGACY, null, null), track(ORG_SONG, null, ORG, { type: 'song' })],
      track_tags: [
        { id: 'tt1', track_id: MINE, tag: 'mine-tag', category: 'custom' },
        { id: 'tt2', track_id: ORG_SONG, tag: 'unreleased-single-codename', category: 'custom' },
      ],
    },
  };
  mem = memoryAdmin(db);
});

describe('GET /api/tracks/[id]/similar', () => {
  it('ranks only the producer’s own tracks (legacy ownerless ones included), never an org song', async () => {
    const { GET } = await import('./[id]/similar/route');
    const res = await GET(new NextRequest(`http://localhost/api/tracks/${MINE}/similar?limit=50`), { params: Promise.resolve({ id: MINE }) });
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain(MINE_2);
    expect(body).toContain(LEGACY);
    expect(body).not.toContain(ORG_SONG);
    expect(body).not.toContain(`orgs/${ORG}`);
  });
});

describe('POST /api/tracks/tags/bulk', () => {
  it('tags the producer’s tracks and leaves an org track alone', async () => {
    const { POST } = await import('./tags/bulk/route');
    const res = await POST(
      new NextRequest('http://localhost/api/tracks/tags/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [MINE, ORG_SONG], add: ['dark'], remove: ['unreleased-single-codename'] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
    const tags = db.tables.track_tags;
    expect(tags.some((t) => t.track_id === MINE && t.tag === 'dark')).toBe(true);
    expect(tags.some((t) => t.track_id === ORG_SONG && t.tag === 'dark')).toBe(false);
    expect(tags.some((t) => t.track_id === ORG_SONG && t.tag === 'unreleased-single-codename')).toBe(true);
  });
});

describe('GET /api/tracks/tags', () => {
  it('lists the tags on the producer’s tracks only', async () => {
    // The memory db has no embedded-resource filter, so answer the one
    // query this route makes the way PostgREST does: join, then apply the
    // `or` / `is` filters to the embedded track.
    const rows = () => db.tables.track_tags.map((t) => ({ tag: t.tag, category: t.category, tracks: db.tables.tracks.find((x) => x.id === t.track_id)! }));
    const fakeFrom = () => {
      const embedded: Array<(t: Record<string, unknown>) => boolean> = [];
      const q = {
        select: () => q,
        or: (expr: string, opts?: { referencedTable?: string }) => {
          if (opts?.referencedTable !== 'tracks') throw new Error('unexpected or');
          const arms = expr.split(',');
          embedded.push((t) => arms.some((a) => (a === `user_id.eq.${ME}` ? t.user_id === ME : a === 'user_id.is.null' ? t.user_id === null : false)));
          return q;
        },
        is: (col: string, v: null) => {
          if (col !== 'tracks.org_id') throw new Error(`unexpected is(${col})`);
          embedded.push((t) => t.org_id === v);
          return q;
        },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows().filter((r) => embedded.every((f) => f(r.tracks))), error: null }),
      };
      return q;
    };
    mem.client.from = fakeFrom as unknown as typeof mem.client.from;
    const { GET } = await import('./tags/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('mine-tag');
    expect(body).not.toContain('unreleased-single-codename');
  });
});
