/**
 * Route tests for /api/tracks/[id].
 *
 * Single-track GET/PATCH/DELETE — all three ride the *Owned facade
 * helpers, so the surface to mock is small: stub the helpers, assert
 * routing.
 *
 * Notable contract pinned here: PATCH validates via TrackPatchBodySchema
 * BEFORE calling the facade. A malformed body must 400 without touching
 * the DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockGetOwned = vi.fn();
const mockUpdateOwned = vi.fn();
const mockDeleteOwned = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockQuery = vi.fn();

vi.mock('@/lib/db', () => ({
  getOwned: (...args: unknown[]) => mockGetOwned(...args),
  updateOwned: (...args: unknown[]) => mockUpdateOwned(...args),
  deleteOwned: (...args: unknown[]) => mockDeleteOwned(...args),
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  query: (...args: unknown[]) => mockQuery(...args),
  // The route uses isErrorResponse to distinguish a NextResponse error
  // from a raw row. Mirror the production check: anything with a
  // numeric .status and a .json() method is an error response.
  isErrorResponse: (v: unknown) =>
    typeof v === 'object' && v !== null &&
    typeof (v as { status?: number }).status === 'number' &&
    typeof (v as { json?: unknown }).json === 'function',
}));

const mockPrune = vi.fn();
vi.mock('@/lib/audio/mp3-deliverable.server', () => ({
  pruneTrackMp3s: (...args: unknown[]) => mockPrune(...args),
}));

function buildReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tracks/t-1', {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function loadRoute() {
  return import('./route');
}

describe('GET /api/tracks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);
  });

  it('returns the row from getOwned on supabase path', async () => {
    mockGetOwned.mockResolvedValueOnce({ id: 't-1', title: 'Test' });
    const mod = await loadRoute();
    const res = await mod.GET(buildReq('GET'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 't-1', title: 'Test' });
    expect(mockGetOwned).toHaveBeenCalledWith('tracks', 't-1', expect.any(Object));
  });

  it('propagates the error response from getOwned', async () => {
    mockGetOwned.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const mod = await loadRoute();
    const res = await mod.GET(buildReq('GET'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(403);
  });

  it('local-store path attaches tags and stems', async () => {
    mockIsSupabaseConfigured.mockReturnValue(false);
    mockGetOwned.mockResolvedValueOnce({ id: 't-1', title: 'Test' });
    mockQuery
      .mockReturnValueOnce([{ tag: 'trap', category: 'genre' }]) // track_tags
      .mockReturnValueOnce([{ status: 'done' }]);                // stems
    const mod = await loadRoute();
    const res = await mod.GET(buildReq('GET'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.track_tags).toHaveLength(1);
    expect(body.stems).toHaveLength(1);
  });
});

describe('PATCH /api/tracks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);
  });

  it('rejects unknown columns with 400 (strict Zod)', async () => {
    const mod = await loadRoute();
    const res = await mod.PATCH(
      buildReq('PATCH', { not_a_real_column: 'value' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(400);
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it('rejects invalid type enum with 400', async () => {
    const mod = await loadRoute();
    const res = await mod.PATCH(
      buildReq('PATCH', { type: 'not-a-type' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('accepts `beat` as a valid type (regression — first-class enum value)', async () => {
    mockUpdateOwned.mockResolvedValueOnce({ id: 't-1', type: 'beat' });
    const mod = await loadRoute();
    const res = await mod.PATCH(
      buildReq('PATCH', { type: 'beat' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockUpdateOwned).toHaveBeenCalledWith('tracks', 't-1', { type: 'beat' });
  });

  it('rejects out-of-range rating with 400', async () => {
    const mod = await loadRoute();
    const res = await mod.PATCH(
      buildReq('PATCH', { rating: 99 }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('propagates ownership response from updateOwned', async () => {
    mockUpdateOwned.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const mod = await loadRoute();
    const res = await mod.PATCH(
      buildReq('PATCH', { title: 'new title' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(401);
  });

  it('returns the updated track wrapped under .track', async () => {
    mockUpdateOwned.mockResolvedValueOnce({ id: 't-1', title: 'new title' });
    const mod = await loadRoute();
    const res = await mod.PATCH(
      buildReq('PATCH', { title: 'new title' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ track: { id: 't-1', title: 'new title' } });
  });
});

describe('DELETE /api/tracks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success:true when deleteOwned resolves true', async () => {
    mockDeleteOwned.mockResolvedValueOnce(true);
    const mod = await loadRoute();
    const res = await mod.DELETE(buildReq('DELETE'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(mockDeleteOwned).toHaveBeenCalledWith('tracks', 't-1');
  });

  it('propagates ownership error', async () => {
    mockDeleteOwned.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const mod = await loadRoute();
    const res = await mod.DELETE(buildReq('DELETE'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(403);
  });

  it('removes the deleted track\'s lease MP3s once the delete succeeded', async () => {
    mockDeleteOwned.mockResolvedValueOnce(true);
    const mod = await loadRoute();
    await mod.DELETE(buildReq('DELETE'), { params: Promise.resolve({ id: 't-1' }) });

    expect(mockPrune).toHaveBeenCalledWith({ id: 't-1', audio_url: null });
  });

  it('removes nothing when the caller does not own the track', async () => {
    mockDeleteOwned.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const mod = await loadRoute();
    await mod.DELETE(buildReq('DELETE'), { params: Promise.resolve({ id: 't-1' }) });

    expect(mockPrune).not.toHaveBeenCalled();
  });
});
