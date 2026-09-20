/**
 * Route tests for /api/tracks/[id]/collaborators.
 *
 * Mirrors the tags-route pattern: mock @/lib/auth/ownership and drive the
 * supabase chain via a stub admin object. Pins two contracts:
 *   - every method calls requireRowOwnership('tracks', id) first
 *   - POST always writes source: 'manual', never touching filename-derived rows
 *   - a missing `track_collaborators` table (migration 115 unapplied) never
 *     surfaces as a raw 500 — GET degrades to [], writes get a readable 503
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockRequireRowOwnership = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireRowOwnership: (...args: unknown[]) => mockRequireRowOwnership(...args),
}));

function buildReq(method: 'GET' | 'POST' | 'DELETE', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tracks/t-1/collaborators', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function loadRoute() {
  return import('./route');
}

const missingTableError = { message: "Could not find the table 'public.track_collaborators' in the schema cache" };

describe('GET /api/tracks/[id]/collaborators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when ownership check fails', async () => {
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: false,
      res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });
    const mod = await loadRoute();
    const res = await mod.GET(buildReq('GET'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(401);
    expect(mockRequireRowOwnership).toHaveBeenCalledWith('tracks', 't-1');
  });

  it('lists collaborators when ownership passes', async () => {
    const rows = [{ id: 'c-1', track_id: 't-1', name: 'Metro', role: 'producer', source: 'filename', created_at: 'now' }];
    const mockOrder = vi.fn().mockResolvedValue({ data: rows, error: null });
    const mockEq = vi.fn(() => ({ order: mockOrder }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: true,
      userId: 'u-1',
      admin: { from: () => ({ select: mockSelect }) },
    });
    const mod = await loadRoute();
    const res = await mod.GET(buildReq('GET'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('degrades to an empty list when the table is missing, never a 500', async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: null, error: missingTableError });
    const mockEq = vi.fn(() => ({ order: mockOrder }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: true,
      userId: 'u-1',
      admin: { from: () => ({ select: mockSelect }) },
    });
    const mod = await loadRoute();
    const res = await mod.GET(buildReq('GET'), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe('POST /api/tracks/[id]/collaborators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed body with 400', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(buildReq('POST', { foo: 'bar' }), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(400);
    expect(mockRequireRowOwnership).not.toHaveBeenCalled();
  });

  it('rejects an unknown role with 400', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(
      buildReq('POST', { name: 'Metro', role: 'engineer' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 when ownership says forbidden', async () => {
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: false,
      res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const mod = await loadRoute();
    const res = await mod.POST(
      buildReq('POST', { name: 'Metro', role: 'producer' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('always writes source: manual', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: 'c-1', track_id: 't-1', name: 'Metro', role: 'producer', source: 'manual', created_at: 'now' },
      error: null,
    });
    const mockSelect = vi.fn(() => ({ single: mockSingle }));
    const mockInsert = vi.fn(() => ({ select: mockSelect }));
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: true,
      userId: 'u-1',
      admin: { from: () => ({ insert: mockInsert }) },
    });
    const mod = await loadRoute();
    const res = await mod.POST(
      buildReq('POST', { name: 'Metro', role: 'producer' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith({ track_id: 't-1', name: 'Metro', role: 'producer', source: 'manual' });
  });

  it('returns 409 on a duplicate (track_id, name, role) credit', async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    const mockSelect = vi.fn(() => ({ single: mockSingle }));
    const mockInsert = vi.fn(() => ({ select: mockSelect }));
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: true,
      userId: 'u-1',
      admin: { from: () => ({ insert: mockInsert }) },
    });
    const mod = await loadRoute();
    const res = await mod.POST(
      buildReq('POST', { name: 'Metro', role: 'producer' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('returns a readable 503 (not a raw 500) when the table is missing', async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: missingTableError });
    const mockSelect = vi.fn(() => ({ single: mockSingle }));
    const mockInsert = vi.fn(() => ({ select: mockSelect }));
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: true,
      userId: 'u-1',
      admin: { from: () => ({ insert: mockInsert }) },
    });
    const mod = await loadRoute();
    const res = await mod.POST(
      buildReq('POST', { name: 'Metro', role: 'producer' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(503);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/migration/i);
  });
});

describe('DELETE /api/tracks/[id]/collaborators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed body with 400', async () => {
    const mod = await loadRoute();
    const res = await mod.DELETE(buildReq('DELETE', {}), { params: Promise.resolve({ id: 't-1' }) });
    expect(res.status).toBe(400);
  });

  it('removes the row scoped to both id and track_id', async () => {
    const eqStep2 = vi.fn().mockResolvedValue({ error: null });
    const eqStep1 = vi.fn(() => ({ eq: eqStep2 }));
    const mockDelete = vi.fn(() => ({ eq: eqStep1 }));
    mockRequireRowOwnership.mockResolvedValueOnce({
      ok: true,
      userId: 'u-1',
      admin: { from: () => ({ delete: mockDelete }) },
    });
    const mod = await loadRoute();
    const res = await mod.DELETE(
      buildReq('DELETE', { id: 'c-1' }),
      { params: Promise.resolve({ id: 't-1' }) },
    );
    expect(res.status).toBe(200);
    expect(eqStep1).toHaveBeenCalledWith('id', 'c-1');
    expect(eqStep2).toHaveBeenCalledWith('track_id', 't-1');
  });
});
