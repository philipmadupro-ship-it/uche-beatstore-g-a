/**
 * Route tests for /api/store/projects/[id].
 *
 * Public-by-design endpoint that returns a project + its tracks for
 * the /store/projects/[id] storefront page. Key contract:
 *   - 404 unless store_featured = true (un-featured projects shouldn't
 *     leak via direct URL).
 *   - Tracks come back in project_tracks.position order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockFromQueue: Array<(table: string) => any> = [];

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const handler = mockFromQueue.shift();
      if (!handler) throw new Error(`No mock for from('${table}') — queue empty`);
      return handler(table);
    },
  }),
}));

/** Helper: build a chainable selector that resolves to the given data. */
function singleResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }),
        maybeSingle: () => Promise.resolve({ data, error }),
      }),
    }),
  });
}

function listResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data, error }),
      }),
      in: () => Promise.resolve({ data, error }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFromQueue.length = 0;
});

async function loadRoute() {
  return import('./route');
}

const PROJECT_ID = '22222222-2222-2222-2222-222222222222';

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/store/projects/${PROJECT_ID}`);
}

describe('GET /api/store/projects/[id]', () => {
  it('returns 404 when Supabase is not configured', async () => {
    mockIsSupabaseConfigured.mockReturnValue(false);
    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 when project is not store_featured', async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    // The .eq('store_featured', true) clause means the row simply
    // doesn't come back for unfeatured projects.
    mockFromQueue.push(singleResult(null));
    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns project + tracks + creator on the happy path', async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);

    // 1. projects.select().eq().eq().maybeSingle
    mockFromQueue.push(singleResult({
      id: PROJECT_ID,
      user_id: 'seller-1',
      name: 'Bundle One',
      cover_url: 'https://r2/proj.jpg',
      description: 'Test bundle',
      price_usd: 49,
      store_featured: true,
      created_at: '2026-01-01T00:00:00Z',
    }));

    // 2. project_tracks.select().eq().order
    mockFromQueue.push(listResult([
      { track_id: 'track-a', position: 0 },
      { track_id: 'track-b', position: 1 },
    ]));

    // 3. tracks.select().in
    mockFromQueue.push(listResult([
      { id: 'track-a', title: 'Track A', type: 'beat', cover_url: null },
      { id: 'track-b', title: 'Track B', type: 'beat', cover_url: null },
    ]));

    // 4. creator_profiles.select().eq().maybeSingle
    mockFromQueue.push(singleResult({
      display_name: 'Seller One',
      contact_email: 'seller@x.io',
    }));

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.id).toBe(PROJECT_ID);
    expect(body.project.price_usd).toBe(49);
    // user_id stripped from the response
    expect(body.project).not.toHaveProperty('user_id');
    expect(body.tracks).toHaveLength(2);
    // Ordered by junction.position
    expect(body.tracks[0].id).toBe('track-a');
    expect(body.tracks[1].id).toBe('track-b');
    expect(body.creator?.display_name).toBe('Seller One');
  });
});
