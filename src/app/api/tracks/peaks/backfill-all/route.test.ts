import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireUser = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockReadStoredObject = vi.fn();
// The route now goes through one helper that builds and uploads BOTH sidecars,
// so that is the seam to mock rather than extractPeaks + uploadPeaksSidecar.
const mockBuildAndUploadSidecars = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => mockRequireUser(),
}));

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/audio/sidecars', () => ({
  buildAndUploadSidecars: (...args: unknown[]) => mockBuildAndUploadSidecars(...args),
}));

vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: (...args: unknown[]) => mockReadStoredObject(...args),
}));

vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function req(path = '/api/tracks/peaks/backfill-all'): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: 'POST' });
}

function createTracksAdmin(tracks: Array<{ id: string; title: string; audio_url: string }>) {
  const eqCalls: Array<[string, unknown]> = [];
  const orCalls: string[] = [];
  const updateCalls: Array<{ patch: Record<string, unknown>; id: string }> = [];
  const selectChain = {
    eq: vi.fn((field: string, value: unknown) => {
      eqCalls.push([field, value]);
      return selectChain;
    }),
    is: vi.fn(() => selectChain),
    // The backfill selects tracks missing EITHER sidecar. It used to filter
    // `.is('peaks_url', null)`, which would now skip the whole existing
    // catalogue — those tracks all have peaks and none have bands.
    or: vi.fn((filter: string) => {
      orCalls.push(filter);
      return selectChain;
    }),
    not: vi.fn(() => Promise.resolve({ data: tracks, error: null })),
  };
  const table = {
    select: vi.fn(() => selectChain),
    update: vi.fn((patch: Record<string, unknown>) => ({
      eq: vi.fn((field: string, value: string) => {
        if (field === 'id') updateCalls.push({ patch, id: value });
        return Promise.resolve({ error: null });
      }),
    })),
  };
  const admin = {
    from: vi.fn((tableName: string) => {
      if (tableName !== 'tracks') throw new Error(`Unexpected table: ${tableName}`);
      return table;
    }),
  };
  return { admin, eqCalls, orCalls, updateCalls, table, selectChain };
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockReadStoredObject.mockResolvedValue(Buffer.from('audio'));
  mockBuildAndUploadSidecars.mockResolvedValue({
    peaksUrl: 'https://pub.r2.dev/peaks/track-1.json',
    bandsUrl: 'https://pub.r2.dev/peaks/track-1.bands.json',
    undecodable: false,
  });
});

describe('POST /api/tracks/peaks/backfill-all', () => {
  it('scopes the backfill to listed tracks when requested', async () => {
    const { admin, eqCalls, updateCalls } = createTracksAdmin([
      { id: 'track-1', title: 'Listed Beat', audio_url: 'r2://tracks/track-1.mp3' },
    ]);
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'user-1', admin });

    const mod = await loadRoute();
    const res = await mod.POST(req('/api/tracks/peaks/backfill-all?store_listed=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope).toBe('store_listed');
    expect(eqCalls).toContainEqual(['user_id', 'user-1']);
    expect(eqCalls).toContainEqual(['store_listed', true]);
    expect(body.succeeded).toBe(1);
    expect(updateCalls).toEqual([
      {
        id: 'track-1',
        patch: {
          peaks_url: 'https://pub.r2.dev/peaks/track-1.json',
          bands_url: 'https://pub.r2.dev/peaks/track-1.bands.json',
        },
      },
    ]);
  });

  it('selects tracks missing EITHER sidecar, not just tracks with no peaks', async () => {
    // The filter used to be `.is('peaks_url', null)`. Left alone, it would skip
    // the entire existing catalogue — every one of those tracks already has
    // peaks and none has bands — so the backfill would report success while
    // converting nothing, and the store would keep decoding in-browser.
    const { admin, orCalls } = createTracksAdmin([]);
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'user-1', admin });

    const mod = await loadRoute();
    await mod.POST(req());

    expect(orCalls).toEqual(['peaks_url.is.null,bands_url.is.null']);
  });

  it('keeps the legacy all-track scope when no store filter is present', async () => {
    const { admin, eqCalls } = createTracksAdmin([]);
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'user-1', admin });

    const mod = await loadRoute();
    const res = await mod.POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope).toBe('all');
    expect(eqCalls).toEqual([['user_id', 'user-1']]);
    expect(body.total_needed).toBe(0);
    expect(mockReadStoredObject).not.toHaveBeenCalled();
  });

  it('reports per-track extraction failures without aborting the batch', async () => {
    const { admin } = createTracksAdmin([
      { id: 'track-1', title: 'Broken Beat', audio_url: 'r2://tracks/track-1.mp3' },
    ]);
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'user-1', admin });
    mockBuildAndUploadSidecars.mockResolvedValueOnce({ peaksUrl: null, bandsUrl: null, undecodable: true });

    const mod = await loadRoute();
    const res = await mod.POST(req('/api/tracks/peaks/backfill-all?store_listed=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      scope: 'store_listed',
      total_needed: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(body.results[0]).toMatchObject({ id: 'track-1', ok: false });
  });
});
