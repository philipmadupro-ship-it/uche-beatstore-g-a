import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const TRACK_COUNT = 600;
const PAGE_SIZE = 80;
const tracks = Array.from({ length: TRACK_COUNT }, (_, index) => ({
  id: `scale-track-${index + 1}`,
  title: `Scale Beat ${String(index + 1).padStart(3, '0')}`,
  type: index % 8 === 0 ? 'song' : 'beat',
  store_listed: true,
  store_featured: index < 12,
  store_sort_order: index,
  audio_url: `r2://privatebuckets/scale/${index + 1}.wav`,
  preview_url: `https://cdn.example.test/previews/${index + 1}.mp3`,
  cover_url: `https://cdn.example.test/covers/${index + 1}.webp`,
  description: `Fixture beat ${index + 1}`,
  bpm: 80 + (index % 100),
  key: ['C', 'D', 'E', 'F', 'G', 'A', 'B'][index % 7],
  scale: index % 2 ? 'minor' : 'major',
  duration_seconds: 90 + (index % 240),
  lease_price_usd: 20 + (index % 60),
  exclusive_price_usd: 250 + index,
  free_download_enabled: index % 20 === 0,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, index % 60, index % 60)).toISOString(),
}));
const tags = tracks.flatMap((track, index) => [
  { track_id: track.id, tag: index % 2 ? 'Trap' : 'Afrobeats', category: 'genre' },
  { track_id: track.id, tag: index % 3 ? 'Dark' : 'Melodic', category: 'mood' },
]);

const mockGetAll = vi.fn((table: string) => {
  if (table === 'tracks') return tracks;
  if (table === 'track_tags') return tags;
  if (table === 'creator_profiles') return [{ display_name: 'Scale Producer' }];
  return [];
});
const mockQuery = vi.fn((table: string) => {
  if (table === 'tracks') return tracks;
  if (table === 'track_tags') return tags;
  if (table === 'creator_profiles') return [{ license_lease_price_usd: 30 }];
  if (table === 'licenses') return [{ id: 'lease', price_usd: 30, is_free: false }];
  if (table === 'track_licenses') {
    return tracks.map((track) => ({
      track_id: track.id, license_id: 'lease', price_override_usd: null, enabled: true,
    }));
  }
  return [];
});

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => false,
  getAll: (table: string) => mockGetAll(table),
}));
vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => false,
  requireUser: vi.fn(),
  query: (table: string) => mockQuery(table),
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: vi.fn(),
  safeSellerId: (id?: string) => id ?? '',
}));

let storeGet: (request: NextRequest) => Promise<Response>;
let facetsGet: () => Promise<Response>;
let summaryGet: () => Promise<Response>;

beforeAll(async () => {
  storeGet = (await import('./route')).GET;
  facetsGet = (await import('./facets/route')).GET;
  summaryGet = (await import('../tracks/store-summary/route')).GET;
});

describe('600-beat catalogue budgets', () => {
  it('keeps the initial public page bounded and free of private masters', async () => {
    const startedAt = performance.now();
    const response = await storeGet(new NextRequest(`http://localhost/api/store?limit=${PAGE_SIZE}`));
    const body = await response.json();
    const elapsedMs = performance.now() - startedAt;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.tracks).toHaveLength(PAGE_SIZE);
    expect(body.pageInfo).toEqual({ hasMore: true, nextCursor: String(PAGE_SIZE) });
    expect(serialized).not.toContain('r2://privatebuckets');
    expect(Buffer.byteLength(serialized)).toBeLessThan(256 * 1024);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('filters the full fixture before slicing the page', async () => {
    const response = await storeGet(new NextRequest('http://localhost/api/store?limit=80&q=Scale%20Beat%20599'));
    const body = await response.json();
    expect(body.tracks.map((track: { id: string }) => track.id)).toEqual(['scale-track-599']);
    expect(body.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  });

  it('keeps facets and Store Editor summary compact at full scale', async () => {
    const [facetsResponse, summaryResponse] = await Promise.all([facetsGet(), summaryGet()]);
    const facets = await facetsResponse.json();
    const summary = await summaryResponse.json();

    expect(facets.total).toBe(TRACK_COUNT);
    expect(summary.total).toBe(TRACK_COUNT);
    expect(summary.producerPicks).toHaveLength(12);
    expect(Buffer.byteLength(JSON.stringify(facets))).toBeLessThan(16 * 1024);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(32 * 1024);
  });

  it('handles a burst of 20 bounded catalogue requests within the CPU budget', async () => {
    const startedAt = performance.now();
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      storeGet(new NextRequest(`http://localhost/api/store?limit=80&cursor=${(index % 7) * 80}`)),
    ));
    const elapsedMs = performance.now() - startedAt;
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
