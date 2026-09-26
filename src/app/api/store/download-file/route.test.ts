import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let accessRow: { project_id: string; expires_at: string | null } | null = null;
const mockStream = vi.fn(async () => new Response('bytes', { status: 200 }));

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/audio/stream-source', () => ({ streamAudioSource: (...a: unknown[]) => mockStream(...(a as [])) }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () => {
          if (table === 'license_purchases') return { data: null };
          if (table === 'project_access_links') return { data: accessRow };
          if (table === 'project_tracks') return { data: { track_id: 't1' } };
          if (table === 'tracks') return { data: { audio_url: 'r2://priv/master.wav', wav_url: 'r2://priv/master.wav', title: 'Beat' } };
          return { data: null };
        },
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const call = () => GET(new NextRequest('http://localhost/api/store/download-file?session_id=cs_proj&track_id=t1&format=wav'));

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/store/download-file — project bundle by session', () => {
  it('refuses a refunded/disputed bundle (expired access link)', async () => {
    accessRow = { project_id: 'p1', expires_at: '2020-01-01T00:00:00Z' };
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('serves an active bundle', async () => {
    accessRow = { project_id: 'p1', expires_at: null };
    const res = await call();
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });
});
