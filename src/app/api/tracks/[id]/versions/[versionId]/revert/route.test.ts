import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true, getById: vi.fn(), getAll: vi.fn(), insert: vi.fn(), update: vi.fn() }));

const mockRequireRowOwnership = vi.fn();
vi.mock('@/lib/auth/ownership', () => ({ requireRowOwnership: (...a: unknown[]) => mockRequireRowOwnership(...a) }));

const mockPrune = vi.fn();
vi.mock('@/lib/audio/mp3-deliverable.server', () => ({ pruneTrackMp3s: (...a: unknown[]) => mockPrune(...a) }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ id: 'track-1', versionId: 'v1' }) };
const req = () => new NextRequest('http://localhost/api/tracks/track-1/versions/v1/revert', { method: 'POST' });

/** A fake client keyed by table + operation, recording the track update. */
function admin(opts: { updateError?: { message: string } | null } = {}) {
  const updates: unknown[] = [];
  return {
    updates,
    client: {
      from: (table: string) => {
        let op = 'select';
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          insert: () => { op = 'insert'; return Promise.resolve({ error: null }); },
          update: (patch: unknown) => { op = 'update'; updates.push(patch); return chain; },
          single: () => {
            if (op === 'update') return Promise.resolve({ data: { id: 'track-1' }, error: opts.updateError ?? null });
            return Promise.resolve({ data: table === 'tracks' ? { id: 'track-1', audio_url: 'r2://p/tracks/current.wav' } : { id: 'v1', track_id: 'track-1', audio_url: 'r2://p/tracks/old.wav' }, error: null });
          },
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ version_number: 1 }], error: null }).then(res),
        };
        return chain;
      },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/tracks/[id]/versions/[versionId]/revert and the lease MP3', () => {
  it('prunes the MP3s of the master it replaced, keeping the restored master\'s', async () => {
    const a = admin();
    mockRequireRowOwnership.mockResolvedValue({ ok: true, userId: 'u1', admin: a.client });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect(a.updates[0]).toMatchObject({ audio_url: 'r2://p/tracks/old.wav' });
    expect(mockPrune).toHaveBeenCalledWith({ id: 'track-1', audio_url: 'r2://p/tracks/old.wav' });
  });

  it('prunes nothing when the revert itself failed, and nothing for a track the caller does not own', async () => {
    const failing = admin({ updateError: { message: 'boom' } });
    mockRequireRowOwnership.mockResolvedValue({ ok: true, userId: 'u1', admin: failing.client });
    expect((await POST(req(), ctx)).status).toBe(500);

    mockRequireRowOwnership.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await POST(req(), ctx)).status).toBe(403);

    expect(mockPrune).not.toHaveBeenCalled();
  });
});
