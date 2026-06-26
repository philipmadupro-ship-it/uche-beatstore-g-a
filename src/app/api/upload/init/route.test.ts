/**
 * Route tests for /api/upload/init.
 *
 * Reliability contract:
 * - invalid files fail before storage work begins
 * - project/playlist destinations are verified before multipart init
 * - destination lookup/auth failures do not get swallowed into a doomed upload
 * - auth lookup failure can still degrade gracefully for plain library uploads
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInitMultipart = vi.fn();
const mockCreateSession = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('nanoid', () => ({ nanoid: () => 'sess_test_123' }));

vi.mock('@/lib/storage/multipart', () => ({
  DEFAULT_PART_SIZE: 8 * 1024 * 1024,
  MAX_PARTS: 10_000,
  MIN_PART_SIZE: 5 * 1024 * 1024,
  initMultipart: (...args: unknown[]) => mockInitMultipart(...args),
}));

vi.mock('@/lib/storage/upload-sessions', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
}));

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => mockMaybeSingle({ table, columns, column, value }),
        }),
      }),
    }),
  }),
}));

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/upload/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockInitMultipart.mockResolvedValue({ uploadId: 'upload-1', key: 'audio/test.wav' });
  mockCreateSession.mockImplementation((session) => ({
    ...(session as Record<string, unknown>),
    sessionId: (session as { sessionId: string }).sessionId,
  }));
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
});

describe('POST /api/upload/init', () => {
  it('rejects unsupported extensions before multipart storage init', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(req({ fileName: 'notes.txt', fileSize: 1024, fileType: 'text/plain' }));

    expect(res.status).toBe(415);
    expect(mockInitMultipart).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown upload destination before multipart storage init', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(req({
      fileName: 'beat.wav',
      fileSize: 1024 * 1024,
      fileType: 'audio/wav',
      projectId: 'missing-destination',
    }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Upload destination not found' });
    expect(mockMaybeSingle).toHaveBeenCalledWith(expect.objectContaining({ table: 'projects' }));
    expect(mockMaybeSingle).toHaveBeenCalledWith(expect.objectContaining({ table: 'playlists' }));
    expect(mockInitMultipart).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 403 when the destination belongs to another user', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'project-1', user_id: 'user-2' },
      error: null,
    });

    const mod = await loadRoute();
    const res = await mod.POST(req({
      fileName: 'beat.wav',
      fileSize: 1024 * 1024,
      fileType: 'audio/wav',
      projectId: 'project-1',
    }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden project destination' });
    expect(mockInitMultipart).not.toHaveBeenCalled();
  });

  it('creates a multipart session when the destination is owned by the user', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'project-1', user_id: 'user-1' },
      error: null,
    });

    const mod = await loadRoute();
    const res = await mod.POST(req({
      fileName: 'beat.wav',
      fileSize: 1024 * 1024,
      fileType: 'audio/wav',
      projectId: 'project-1',
    }));

    expect(res.status).toBe(200);
    expect(mockInitMultipart).toHaveBeenCalledWith('beat.wav', 'audio/wav');
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess_test_123',
      projectId: 'project-1',
      userId: 'user-1',
    }));
  });

  it('does not swallow auth lookup failure for destination uploads', async () => {
    mockGetUser.mockRejectedValueOnce(new Error('auth unavailable'));

    const mod = await loadRoute();
    const res = await mod.POST(req({
      fileName: 'beat.wav',
      fileSize: 1024 * 1024,
      fileType: 'audio/wav',
      projectId: 'project-1',
    }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'Could not verify uploader: auth unavailable',
    });
    expect(mockInitMultipart).not.toHaveBeenCalled();
  });

  // Security: uploads are producer-only. A library upload (no destination)
  // must NOT proceed anonymously — previously this returned 200 with a
  // null-owner session, letting an unauthenticated visitor stream up to
  // MAX_BYTES into R2.
  it('rejects a library upload when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const mod = await loadRoute();
    const res = await mod.POST(req({
      fileName: 'beat.wav',
      fileSize: 1024 * 1024,
      fileType: 'audio/wav',
    }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(mockInitMultipart).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a library upload when the auth lookup throws', async () => {
    mockGetUser.mockRejectedValueOnce(new Error('auth unavailable'));

    const mod = await loadRoute();
    const res = await mod.POST(req({
      fileName: 'beat.wav',
      fileSize: 1024 * 1024,
      fileType: 'audio/wav',
    }));

    expect(res.status).toBe(401);
    expect(mockInitMultipart).not.toHaveBeenCalled();
  });
});
