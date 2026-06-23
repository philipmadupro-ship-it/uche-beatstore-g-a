/**
 * Route tests for /api/store/projects/access/[token].
 *
 * Token-gated delivery endpoint reached from the Stripe webhook email.
 * Key contract:
 *   - 404 for unknown token AND for expired token (don't leak which).
 *   - Returns project + tracks with token-gated download URLs.
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

function singleResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }),
    }),
  });
}

function listResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => ({ order: () => Promise.resolve({ data, error }) }),
      in: () => Promise.resolve({ data, error }),
    }),
  });
}

const TOKEN = 'a'.repeat(48);

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/store/projects/access/${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFromQueue.length = 0;
});

async function loadRoute() {
  return import('./route');
}

describe('GET /api/store/projects/access/[token]', () => {
  it('returns 404 when Supabase is not configured', async () => {
    mockIsSupabaseConfigured.mockReturnValue(false);
    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown token', async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockFromQueue.push(singleResult(null));
    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an expired token (don\'t leak existence)', async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    const past = new Date(Date.now() - 60_000).toISOString();
    mockFromQueue.push(singleResult({
      id: 'access-1',
      project_id: 'proj-1',
      buyer_email: 'b@x.io',
      expires_at: past,
      created_at: '2026-01-01T00:00:00Z',
    }));
    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(404);
  });

  it('returns project + tracks + creator on a valid token', async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);

    // 1. project_access_links.select().eq().maybeSingle
    mockFromQueue.push(singleResult({
      id: 'access-1',
      project_id: 'proj-1',
      buyer_email: 'b@x.io',
      expires_at: null,
      created_at: '2026-01-01T00:00:00Z',
    }));

    // 2. projects.select().eq().maybeSingle
    mockFromQueue.push(singleResult({
      id: 'proj-1',
      user_id: 'seller-1',
      name: 'Bundle One',
      cover_url: null,
      description: 'desc',
      price_usd: 49,
    }));

    // 3. project_tracks.select().eq().order
    mockFromQueue.push(listResult([
      { track_id: 'track-a', position: 0 },
    ]));

    // 4. tracks.select().in
    mockFromQueue.push(listResult([
      { id: 'track-a', title: 'Track A', type: 'beat', audio_url: 'https://r2/a.mp3', wav_url: 'https://r2/a.wav', cover_url: null },
    ]));

    // 5. track_tags.select().in (genre/mood chips for the listening page)
    mockFromQueue.push(listResult([]));

    // 6. creator_profiles.select().eq().maybeSingle
    mockFromQueue.push(singleResult({ display_name: 'Seller One', contact_email: 's@x.io' }));

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.id).toBe('proj-1');
    expect(body.project).not.toHaveProperty('user_id');
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].audio_url).toContain('/api/store/projects/access/');
    expect(body.tracks[0].audio_url).toContain('format=mp3');
    expect(body.tracks[0].wav_url).toContain('/api/store/projects/access/');
    expect(body.tracks[0].wav_url).toContain('format=wav');
    // Regression (B2-19): buyer_email no longer in response to avoid
    // leaking PII to anyone who shares the access URL.
    expect(body.access).not.toHaveProperty('buyer_email');
    expect(body.access.granted_at).toBeDefined();
  });
});
