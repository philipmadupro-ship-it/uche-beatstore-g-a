import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));

const mockRequireRowOwnership = vi.fn();
vi.mock('@/lib/auth/ownership', () => ({
  requireRowOwnership: (...a: unknown[]) => mockRequireRowOwnership(...a),
}));

const mockEnsure = vi.fn();
const mockStatus = vi.fn();
vi.mock('@/lib/audio/mp3-deliverable.server', () => ({
  ensureTrackMp3: (...a: unknown[]) => mockEnsure(...a),
  getTrackMp3Status: (...a: unknown[]) => mockStatus(...a),
}));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ id: 'track-1' }) };
const req = () => new NextRequest('http://localhost/api/tracks/track-1/mp3');

/** The row the owner-filtered read returns, and the filters it was asked with. */
let row: { id: string; audio_url: string | null } | null;
let filters: Array<[string, unknown]>;

function owner() {
  mockRequireRowOwnership.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    admin: {
      from: () => {
        const chain = {
          select: () => chain,
          eq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        };
        return chain;
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  row = { id: 'track-1', audio_url: 'r2://private/tracks/a.wav' };
  filters = [];
  owner();
  mockStatus.mockResolvedValue({ state: 'pending', label: 'MP3 not made yet', detail: 'd', canMake: true });
});

describe('/api/tracks/[id]/mp3 — who may ask', () => {
  it.each([
    ['signed out', 401],
    ['another producer\'s track', 403],
    ['a track that does not exist', 404],
  ])('refuses %s with %i and reads nothing', async (_who, status) => {
    mockRequireRowOwnership.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'no' }, { status }) });

    expect((await GET(req(), ctx)).status).toBe(status);
    expect((await POST(req(), ctx)).status).toBe(status);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('re-reads the row with the owner filter, since the service client bypasses RLS', async () => {
    await GET(req(), ctx);
    expect(filters).toContainEqual(['id', 'track-1']);
    expect(filters).toContainEqual(['user_id', 'user-1']);
  });
});

describe('GET /api/tracks/[id]/mp3', () => {
  it('returns the status for the track\'s master', async () => {
    const res = await GET(req(), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'pending', canMake: true });
    expect(mockStatus).toHaveBeenCalledWith({ id: 'track-1', audio_url: 'r2://private/tracks/a.wav' });
  });

  it('does not leak internals on a failure', async () => {
    mockStatus.mockRejectedValue(new Error('R2 secret-internal-detail'));
    const res = await GET(req(), ctx);

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-internal-detail');
  });
});

describe('POST /api/tracks/[id]/mp3 (make it now)', () => {
  it('makes the MP3 and returns the new status', async () => {
    mockEnsure.mockResolvedValue({ kind: 'ref', ref: 'r2://private/deliverables/x.mp3', created: true });
    mockStatus.mockResolvedValue({ state: 'ready', label: 'MP3 ready', detail: 'd', canMake: false });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'ready' });
    expect(mockEnsure).toHaveBeenCalledWith({ id: 'track-1', audio_url: 'r2://private/tracks/a.wav' });
  });

  it('answers 503, not a false "ready", when it cannot be made', async () => {
    mockEnsure.mockResolvedValue(null);
    const res = await POST(req(), ctx);

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ffmpeg/);
  });

  it('answers 503 when it was made but could not be stored', async () => {
    mockEnsure.mockResolvedValue({ kind: 'buffer', buffer: Buffer.from('x') });
    expect((await POST(req(), ctx)).status).toBe(503);
  });

  it('answers 409 for a master with nothing to make (already MP3, or unsupported), without transcoding', async () => {
    row = { id: 'track-1', audio_url: 'r2://private/tracks/a.mp3' };
    expect((await POST(req(), ctx)).status).toBe(409);
    row = { id: 'track-1', audio_url: null };
    expect((await POST(req(), ctx)).status).toBe(409);
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
