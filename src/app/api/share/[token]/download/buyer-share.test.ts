/**
 * Regression: a buyer's session could insert its own share_links row listing
 * the producer's track ids with allow_downloads = true. The download gate
 * trusted the share's track list and streamed the producer's audio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let shareRow: Record<string, unknown> | null;
const mockStream = vi.fn(async () => new Response('bytes', { status: 200 }));
const TRACK_OWNER: Record<string, string> = { 'producer-track': 'producer-1' };
const PRODUCERS = new Set(['producer-1']);

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/audio/stream-source', () => ({ streamAudioSource: (...a: unknown[]) => mockStream(...(a as [])) }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { f[c] ??= v; return chain; },
        in: (c: string, v: unknown) => { f[c] = v; return chain; },
        maybeSingle: async () => {
          if (table === 'share_links') return { data: shareRow };
          if (table === 'creator_profiles') return { data: PRODUCERS.has(String(f.user_id)) ? { user_id: f.user_id } : null };
          if (table === 'tracks') return { data: { audio_url: 'r2://priv/master.wav', title: 'Beat' } };
          return { data: null };
        },
        then: (res: (v: unknown) => unknown) => {
          const ids = (f.id as string[]) ?? [];
          return Promise.resolve({ data: ids.filter((id) => TRACK_OWNER[id] === f.user_id).map((id) => ({ id })) }).then(res);
        },
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const call = () =>
  GET(new NextRequest('http://localhost/api/share/tok123/download?track_id=producer-track'), {
    params: Promise.resolve({ token: 'tok123' }),
  });

beforeEach(() => { vi.clearAllMocks(); });

describe('share download ownership', () => {
  it("refuses a buyer-made share listing the producer's track", async () => {
    shareRow = { user_id: 'buyer-1', track_ids: ['producer-track'], allow_downloads: true, revoked_at: null, expires_at: null, password_hash: null };
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("serves the producer's own download-enabled share", async () => {
    shareRow = { user_id: 'producer-1', track_ids: ['producer-track'], allow_downloads: true, revoked_at: null, expires_at: null, password_hash: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockStream).toHaveBeenCalled();
  });
});
