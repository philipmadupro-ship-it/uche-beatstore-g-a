/**
 * Regression: listed tracks with no preview_url were never backfilled when
 * marked 'ready', or when older unprocessable rows filled the batch first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let pool: Array<Record<string, unknown>> = [];
const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
const mockRead = vi.fn(async () => Buffer.from('RIFFxxxxWAVE'));

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/audio/convert', () => ({ makePreviewMp3Buffer: async () => Buffer.from('mp3') }));
vi.mock('@/lib/audio/peaks', () => ({ extractPeaks: async () => null }));
vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: (...a: unknown[]) => mockRead(...(a as [])),
  uploadPreviewAsset: async () => 'https://pub.example/previews/new',
  uploadPeaksSidecar: async () => null,
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: () => {
      let patch: Record<string, unknown> | null = null;
      const chain = {
        select: () => chain, or: () => chain, eq: (_c: string, v: unknown) => {
          if (patch) { updates.push({ id: v, patch }); return Promise.resolve({ error: null }); }
          return chain;
        },
        order: () => chain,
        limit: async () => ({ data: pool, error: null }),
        update: (p: Record<string, unknown>) => { patch = p; return chain; },
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const call = () => GET(new NextRequest('http://localhost/api/cron/backfill-previews', { headers: { authorization: 'Bearer s' } }));

beforeEach(() => { vi.clearAllMocks(); updates.length = 0; process.env.CRON_SECRET = 's'; });

describe('backfill-previews', () => {
  it("backfills a listed track marked 'ready' with no preview_url, past 10 older unusable rows", async () => {
    const junk = Array.from({ length: 10 }, (_, i) => ({
      id: `junk${i}`, audio_url: 'https://elsewhere/no-extension', preview_status: 'none', preview_url: null,
      peaks_url: null, store_listed: true, created_at: '2020-01-01',
    }));
    pool = [...junk, {
      id: 'push-it', audio_url: 'r2://priv/tracks/abc.wav', preview_status: 'ready', preview_url: null,
      peaks_url: 'https://pub/peaks', store_listed: true, created_at: '2026-09-01',
    }];
    const res = await call();
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(updates).toEqual([{ id: 'push-it', patch: { preview_url: 'https://pub.example/previews/new', preview_status: 'ready' } }]);
  });

  it('rejects calls without the cron secret', async () => {
    const res = await GET(new NextRequest('http://localhost/api/cron/backfill-previews'));
    expect(res.status).toBe(401);
  });
});
