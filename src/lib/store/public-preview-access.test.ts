/**
 * Bundle tracks are public on /store/projects/[id] but mostly not listed on
 * their own, and the preview/peaks routes served only listed tracks — so a
 * bundle's Preview played nothing. These pin the widened rule AND the parts
 * that must not widen: the owner check, and never streaming a private master.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { featuredBundleCovers, publicPreviewSource } from './public-preview-access';

const PRIVATE = 'r2://private-bucket/masters/secret.wav';
const PREVIEW = 'https://pub.r2.dev/previews/clip.mp3';

describe('publicPreviewSource', () => {
  it('prefers the public preview derivative', () => {
    expect(publicPreviewSource({ preview_url: PREVIEW, audio_url: PRIVATE })).toBe(PREVIEW);
  });
  it('falls back to a non-private audio_url', () => {
    expect(publicPreviewSource({ preview_url: null, audio_url: 'https://pub.r2.dev/tracks/a.mp3' }))
      .toBe('https://pub.r2.dev/tracks/a.mp3');
  });
  it('never returns a private r2:// master', () => {
    expect(publicPreviewSource({ preview_url: null, audio_url: PRIVATE })).toBeNull();
    expect(publicPreviewSource({ preview_url: null, audio_url: null })).toBeNull();
  });
});

describe('featuredBundleCovers', () => {
  it('needs a featured bundle owned by the track owner', () => {
    expect(featuredBundleCovers('p1', [{ user_id: 'p1', store_featured: true }])).toBe(true);
    expect(featuredBundleCovers('p1', [{ user_id: 'p1', store_featured: false }])).toBe(false);
    expect(featuredBundleCovers('p1', [{ user_id: 'someone-else', store_featured: true }])).toBe(false);
    expect(featuredBundleCovers(null, [{ user_id: null, store_featured: true }])).toBe(false);
    expect(featuredBundleCovers('p1', [])).toBe(false);
  });
});

/* ─── Routes, against a mocked service client ─────────────────────────── */

let trackRow: Record<string, unknown> | null = null;
let links: Array<{ project_id: string }> = [];
let projects: Array<{ id: string; user_id: string | null; store_featured: boolean }> = [];
const producerIds = new Set(['producer-1']);
const mockStream = vi.fn<(req: unknown, src: string) => Promise<Response>>(async () => new Response('bytes', { status: 200 }));

vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true, getById: () => null }));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioSource: (req: unknown, src: string) => mockStream(req, src),
  streamAudioPreviewSource: (req: unknown, src: string) => mockStream(req, src),
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let inIds: string[] = [];
      const rows = () => {
        if (table === 'project_tracks') return links;
        if (table === 'projects') {
          return projects.filter((p) => inIds.includes(p.id)
            && (filters.store_featured === undefined || p.store_featured === filters.store_featured));
        }
        return [];
      };
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters[c] ??= v; return chain; },
        in: (_c: string, ids: string[]) => { inIds = ids; return chain; },
        maybeSingle: async () => {
          if (table === 'tracks') {
            // Honour column filters the way PostgREST would; the old route
            // relied on `.eq('store_listed', true)` in the query itself.
            const hit = trackRow && Object.entries(filters).every(([c, v]) => c === 'id' || trackRow![c] === v);
            return { data: hit ? trackRow : null, error: null };
          }
          if (table === 'creator_profiles') {
            return { data: producerIds.has(String(filters.user_id)) ? { user_id: filters.user_id } : null };
          }
          return { data: null };
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      };
      return chain;
    },
  }),
}));

const req = (path: string) => new NextRequest(`http://localhost${path}`);
const ctx = { params: Promise.resolve({ id: 't1' }) };

async function preview() {
  const { GET } = await import('@/app/api/store/preview/[id]/route');
  return GET(req('/api/store/preview/t1'), ctx);
}
async function peaks() {
  const { GET } = await import('@/app/api/store/peaks/[id]/route');
  return GET(req('/api/store/peaks/t1'), ctx);
}

const producerTrack = (over: Record<string, unknown> = {}) => ({
  id: 't1', user_id: 'producer-1', store_listed: false,
  preview_url: PREVIEW, audio_url: PRIVATE, peaks_url: 'https://pub.r2.dev/peaks/t1.json', ...over,
});

beforeEach(() => {
  mockStream.mockClear();
  links = [];
  projects = [];
});

describe('GET /api/store/preview/[id]', () => {
  it('streams a listed track (unchanged)', async () => {
    trackRow = producerTrack({ store_listed: true });
    expect((await preview()).status).toBe(200);
    expect(mockStream.mock.calls[0][1]).toBe(PREVIEW);
  });

  it('streams an unlisted track that sits in a featured bundle — the fix', async () => {
    trackRow = producerTrack();
    links = [{ project_id: 'b1' }];
    projects = [{ id: 'b1', user_id: 'producer-1', store_featured: true }];
    expect((await preview()).status).toBe(200);
    expect(mockStream.mock.calls[0][1]).toBe(PREVIEW);
  });

  it('refuses an unlisted track whose only bundle is not featured', async () => {
    trackRow = producerTrack();
    links = [{ project_id: 'b1' }];
    projects = [{ id: 'b1', user_id: 'producer-1', store_featured: false }];
    expect((await preview()).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('refuses an unlisted track in no bundle at all', async () => {
    trackRow = producerTrack();
    expect((await preview()).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('refuses a track a featured bundle does not own', async () => {
    // project_tracks is a plain junction; a bundle must not publish someone
    // else's track just by linking it.
    trackRow = producerTrack({ user_id: 'producer-1' });
    links = [{ project_id: 'b1' }];
    projects = [{ id: 'b1', user_id: 'other-owner', store_featured: true }];
    expect((await preview()).status).toBe(404);
  });

  it('refuses a buyer-owned track even inside a featured bundle', async () => {
    trackRow = producerTrack({ user_id: 'buyer-1' });
    links = [{ project_id: 'b1' }];
    projects = [{ id: 'b1', user_id: 'buyer-1', store_featured: true }];
    expect((await preview()).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('never streams a private master for a bundle track without a preview', async () => {
    trackRow = producerTrack({ preview_url: null, audio_url: PRIVATE });
    links = [{ project_id: 'b1' }];
    projects = [{ id: 'b1', user_id: 'producer-1', store_featured: true }];
    expect((await preview()).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });
});

describe('GET /api/store/peaks/[id]', () => {
  it('serves peaks for a featured-bundle track', async () => {
    trackRow = producerTrack();
    links = [{ project_id: 'b1' }];
    projects = [{ id: 'b1', user_id: 'producer-1', store_featured: true }];
    expect((await peaks()).status).toBe(200);
  });

  it('refuses peaks for an unlisted track in no featured bundle', async () => {
    trackRow = producerTrack();
    expect((await peaks()).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });
});
