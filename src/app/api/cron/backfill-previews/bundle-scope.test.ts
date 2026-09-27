/**
 * The backfill only ever looked at listed tracks, so a track public only
 * through a featured bundle never got a preview clip and its Preview 404'd on
 * the bundle page (67 tracks on production). It now also takes featured-bundle
 * tracks — but only where the bundle's owner owns the track and is the
 * producer, the same rule the preview route streams under.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
let tracks: Row[] = [];
let projects: Row[] = [];
let links: Row[] = [];
const producers = new Set(['producer-1']);
const updated: string[] = [];

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/audio/preview-clip', () => ({
  buildPreviewClip: async () => ({ buffer: Buffer.from('mp3'), ext: 'mp3', contentType: 'audio/mpeg' }),
}));
vi.mock('@/lib/audio/peaks', () => ({ extractPeaks: async () => null }));
vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: async () => Buffer.from('RIFFxxxxWAVE'),
  uploadPreviewAsset: async () => 'https://pub.example/previews/new.mp3',
  uploadPeaksSidecar: async () => null,
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const eq: Record<string, unknown> = {};
      let inCol = '';
      let inIds: string[] = [];
      let patch: Row | null = null;
      const source = () => (table === 'tracks' ? tracks : table === 'projects' ? projects : table === 'project_tracks' ? links : []);
      const rows = () => source().filter((r) =>
        Object.entries(eq).every(([c, v]) => r[c] === v) && (!inCol || inIds.includes(String(r[inCol]))));
      const chain: Record<string, unknown> = {
        select: () => chain,
        or: () => chain,
        order: () => chain,
        in: (c: string, ids: string[]) => { inCol = c; inIds = ids; return chain; },
        eq: (c: string, v: unknown) => {
          if (patch) { updated.push(String(v)); return Promise.resolve({ error: null }); }
          eq[c] = v; return chain;
        },
        update: (p: Row) => { patch = p; return chain; },
        limit: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => (table === 'creator_profiles'
          ? { data: producers.has(String(eq.user_id)) ? { user_id: eq.user_id } : null }
          : { data: rows()[0] ?? null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const call = () => GET(new NextRequest('http://localhost/api/cron/backfill-previews?limit=10', {
  headers: { authorization: 'Bearer s' },
}));

const track = (id: string, over: Row = {}): Row => ({
  id, user_id: 'producer-1', audio_url: `r2://priv/tracks/${id}.wav`, preview_url: null,
  preview_status: null, peaks_url: 'https://pub/peaks.json', store_listed: false, created_at: '2026-09-01', ...over,
});

beforeEach(() => {
  process.env.CRON_SECRET = 's';
  updated.length = 0;
  projects = [
    { id: 'bundle', user_id: 'producer-1', store_featured: true },
    { id: 'hidden', user_id: 'producer-1', store_featured: false },
    { id: 'buyer-bundle', user_id: 'buyer-1', store_featured: true },
  ];
});

describe('backfill-previews covers featured bundles', () => {
  it('makes a clip for an unlisted track in a featured bundle', async () => {
    tracks = [track('in-bundle')];
    links = [{ project_id: 'bundle', track_id: 'in-bundle' }];
    const body = await (await call()).json();
    expect(body.processed).toBe(1);
    expect(updated).toEqual(['in-bundle']);
  });

  it('still processes listed tracks, once each, alongside bundle tracks', async () => {
    tracks = [track('listed', { store_listed: true }), track('in-bundle')];
    links = [{ project_id: 'bundle', track_id: 'in-bundle' }, { project_id: 'bundle', track_id: 'listed' }];
    const body = await (await call()).json();
    expect(body.processed).toBe(2);
    expect([...updated].sort()).toEqual(['in-bundle', 'listed']);
  });

  it('skips a track whose only bundle is not featured', async () => {
    tracks = [track('hidden-only')];
    links = [{ project_id: 'hidden', track_id: 'hidden-only' }];
    expect((await (await call()).json()).processed).toBe(0);
  });

  it("skips a track the bundle's owner does not own", async () => {
    tracks = [track('someone-elses', { user_id: 'other-owner' })];
    links = [{ project_id: 'bundle', track_id: 'someone-elses' }];
    expect((await (await call()).json()).processed).toBe(0);
  });

  it('skips a featured bundle owned by a non-producer', async () => {
    tracks = [track('buyer-track', { user_id: 'buyer-1' })];
    links = [{ project_id: 'buyer-bundle', track_id: 'buyer-track' }];
    expect((await (await call()).json()).processed).toBe(0);
    expect(updated).toEqual([]);
  });
});
