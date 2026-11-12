/**
 * The share's "Download all" zip. The gate must refuse exactly where the single
 * download refuses (dead link, password, downloads off, tracks the owner may not
 * grant), and a grant must stream files only through the storage path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  rate: vi.fn(async () => true),
  resolve: vi.fn(),
  grantable: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => mocks.configured() }));
vi.mock('@/lib/security/rate-limit', () => ({ clientIp: () => '1.2.3.4', rateLimitDurable: mocks.rate }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: table === 'project_tracks' ? [{ track_id: 't1' }, { track_id: 't2' }] : [] }),
        }),
        in: async () => ({
          data: [
            { id: 't1', title: 'One', audio_url: 'r2://private/a.wav' },
            { id: 't2', title: 'Two', audio_url: 'r2://private/b.mp3' },
          ],
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/db/chunked-in', () => ({
  selectIn: async (fn: (chunk: string[]) => Promise<{ data: unknown[] }>, ids: string[]) => (await fn(ids)).data,
}));
vi.mock('@/lib/share/share-owner', () => ({
  projectShareOwnerId: async () => 'owner-1',
  grantableTrackIds: (...args: unknown[]) => mocks.grantable(...args),
}));
vi.mock('@/lib/audio/stream-source', () => ({ streamAudioSource: (...args: unknown[]) => mocks.stream(...args) }));
vi.mock('@/lib/share/token-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/share/token-access')>()),
  resolveShareToken: (...args: unknown[]) => mocks.resolve(...args),
}));

import { GET } from './route';

const share = (over: Record<string, unknown> = {}) => ({
  kind: 'project_share',
  row: { token: 'tok', content_type: 'project', project_id: 'p1', allow_downloads: true, label: 'Beat Tape', revoked_at: null, expires_at: null, password_hash: null, ...over },
});
const call = (headers: Record<string, string> = {}) =>
  GET(new NextRequest('http://localhost/api/share/tok/download-all', { headers }), { params: Promise.resolve({ token: 'tok' }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.rate.mockResolvedValue(true);
  mocks.resolve.mockResolvedValue(share());
  mocks.grantable.mockImplementation(async (_a: unknown, _o: unknown, ids: string[]) => ids);
  mocks.stream.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
});

describe('GET /api/share/[token]/download-all', () => {
  it('404s an unknown token without touching anything else', async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('only honours project shares and share links, never a purchase or portal token', async () => {
    await call();
    expect(mocks.resolve.mock.calls[0][2]).toEqual(['project_share', 'share_link']);
    mocks.resolve.mockResolvedValue({ kind: 'paid_access', row: {} });
    expect((await call()).status).toBe(404);
  });

  it('410s a revoked or expired link before anything else', async () => {
    mocks.resolve.mockResolvedValue(share({ revoked_at: '2026-01-01T00:00:00Z' }));
    expect((await call()).status).toBe(410);
    mocks.resolve.mockResolvedValue(share({ expires_at: '2020-01-01T00:00:00Z' }));
    expect((await call()).status).toBe(410);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('401s a locked share without its password', async () => {
    mocks.resolve.mockResolvedValue(share({ password_hash: 'x'.repeat(20) }));
    expect((await call()).status).toBe(401);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('403s when the producer did not allow downloads', async () => {
    mocks.resolve.mockResolvedValue(share({ allow_downloads: false }));
    expect((await call()).status).toBe(403);
    mocks.resolve.mockResolvedValue(share({ allow_downloads: null }));
    expect((await call()).status).toBe(403);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('429s past the per-IP limit, 503s without Supabase', async () => {
    mocks.rate.mockResolvedValue(false);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    mocks.rate.mockResolvedValue(true);
    mocks.configured.mockReturnValue(false);
    expect((await call()).status).toBe(503);
  });

  it('404s when the owner may grant none of the tracks', async () => {
    mocks.grantable.mockResolvedValue([]);
    expect((await call()).status).toBe(404);
  });

  it('413s past the track cap rather than building a giant archive', async () => {
    mocks.grantable.mockResolvedValue(Array.from({ length: 201 }, (_, i) => `t${i}`));
    expect((await call()).status).toBe(413);
  });

  it('streams a zip of every track through the storage path, with a safe name', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('Beat Tape.zip');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PK local file header, and both entries named in order.
    expect(bytes[0]).toBe(0x50);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('01 One.wav');
    expect(text).toContain('02 Two.mp3');
    // Private references only ever go to the storage helper, never into the response.
    expect(mocks.stream.mock.calls.map((c) => c[1])).toEqual(['r2://private/a.wav', 'r2://private/b.mp3']);
    expect(text).not.toContain('r2://');
  });
});
