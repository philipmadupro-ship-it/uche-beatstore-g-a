/**
 * A clip that cannot be made is marked preview_status='failed', so the next
 * run's small batch reaches the tracks behind it instead of re-trying the same
 * unfixable masters first forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const failIds = new Set<string>();
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/audio/peaks', () => ({ extractPeaks: async () => null }));
vi.mock('@/lib/audio/preview-clip', () => ({
  buildPreviewClip: async () => ({ buffer: Buffer.from('mp3'), ext: 'mp3', contentType: 'audio/mpeg' }),
}));
vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: async (url: string) => {
    if ([...failIds].some((id) => url.includes(id))) throw new Error('NoSuchKey');
    return Buffer.from('RIFFxxxxWAVE');
  },
  uploadPreviewAsset: async () => 'https://pub.example/previews/x.mp3',
  uploadPeaksSidecar: async () => null,
}));

import { runPreviewBackfill } from './preview-backfill';

const writes: Array<{ patch: Record<string, unknown>; eq?: unknown; in?: unknown[] }> = [];
const admin = {
  from: () => ({
    update: (patch: Record<string, unknown>) => ({
      eq: async (_c: string, v: unknown) => { writes.push({ patch, eq: v }); return { error: null }; },
      in: async (_c: string, ids: unknown[]) => { writes.push({ patch, in: ids }); return { error: null }; },
    }),
  }),
};

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, audio_url: `r2://priv/${id}.wav`, preview_url: null, preview_status: 'none',
  peaks_url: 'https://pub/p.json', store_listed: true, created_at: '2026-01-01', ...over,
});

beforeEach(() => { writes.length = 0; failIds.clear(); });

describe('runPreviewBackfill', () => {
  it('marks a clip it could not make as failed, and only that one', async () => {
    failIds.add('broken');
    const res = await runPreviewBackfill(admin, [row('broken'), row('good')], 5);
    expect(res.processed).toBe(1);
    expect(writes).toContainEqual({ patch: { preview_status: 'failed' }, in: ['broken'] });
    expect(writes).toContainEqual({ patch: { preview_url: 'https://pub.example/previews/x.mp3', preview_status: 'ready' }, eq: 'good' });
  });

  it('marks nothing when every clip is made', async () => {
    await runPreviewBackfill(admin, [row('a'), row('b')], 5);
    expect(writes.some((w) => w.patch.preview_status === 'failed')).toBe(false);
  });

  it('does not mark a peaks-only row as a failed preview', async () => {
    failIds.add('peaks-only');
    await runPreviewBackfill(admin, [row('peaks-only', { preview_url: 'https://pub/x.mp3', preview_status: 'ready', peaks_url: null })], 5);
    expect(writes.some((w) => w.patch.preview_status === 'failed')).toBe(false);
  });
});
