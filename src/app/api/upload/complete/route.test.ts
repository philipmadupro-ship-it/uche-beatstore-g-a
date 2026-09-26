/**
 * Route tests for /api/upload/complete.
 *
 * Reliability contract:
 * - missing chunks fail before storage finalize
 * - destination attach failures return errors instead of falling back to local-store success
 * - owned project destinations attach the new track and complete successfully
 * - the queued job is processed straight away via after(), not left for the daily cron
 * - BPM and key written in the filename are applied, and cut from the title
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCompleteMultipart = vi.fn();
const mockReadAssembledBuffer = vi.fn();
const mockListParts = vi.fn();
const mockGetSession = vi.fn();
const mockMarkStatus = vi.fn();
const mockDeleteSession = vi.fn();
const mockAnalyzeAudio = vi.fn();
const mockGetAuddFeatures = vi.fn();
const mockMergeFeatures = vi.fn();
const mockExtractPeaks = vi.fn();
const mockUploadPeaksSidecar = vi.fn();
const mockUploadPublicPreview = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockLocalInsert = vi.fn();
const mockLocalUpdate = vi.fn();
const mockGetAll = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockEnqueueUploadProcessingJob = vi.fn();
const mockProcessJobById = vi.fn();
const afterCallbacks: Array<() => unknown> = [];

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (cb: () => unknown) => { afterCallbacks.push(cb); },
}));

vi.mock('@/lib/storage/multipart', () => ({
  completeMultipart: (...args: unknown[]) => mockCompleteMultipart(...args),
  readAssembledBuffer: (...args: unknown[]) => mockReadAssembledBuffer(...args),
  listParts: (...args: unknown[]) => mockListParts(...args),
}));

vi.mock('@/lib/storage/upload-sessions', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  markStatus: (...args: unknown[]) => mockMarkStatus(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
}));

vi.mock('@/lib/audio/analyze.server', () => ({
  analyzeAudio: (...args: unknown[]) => mockAnalyzeAudio(...args),
}));

vi.mock('@/lib/audio/audd', () => ({
  getAuddFeatures: (...args: unknown[]) => mockGetAuddFeatures(...args),
}));

vi.mock('@/lib/audio/merge', () => ({
  mergeFeatures: (...args: unknown[]) => mockMergeFeatures(...args),
}));

vi.mock('@/lib/audio/peaks', () => ({
  extractPeaks: (...args: unknown[]) => mockExtractPeaks(...args),
}));

const mockDeleteStoredObject = vi.fn();
vi.mock('@/lib/storage/upload', () => ({
  deleteStoredObject: (...args: unknown[]) => mockDeleteStoredObject(...args),
  uploadPeaksSidecar: (...args: unknown[]) => mockUploadPeaksSidecar(...args),
  uploadPublicPreview: (...args: unknown[]) => mockUploadPublicPreview(...args),
}));

const mockVerifyStoredAudio = vi.fn();
vi.mock('@/lib/upload/verify-stored-audio', () => ({
  verifyStoredAudio: (...args: unknown[]) => mockVerifyStoredAudio(...args),
}));

vi.mock('@/lib/upload/processing', () => ({
  enqueueUploadProcessingJob: (...args: unknown[]) => mockEnqueueUploadProcessingJob(...args),
  processUploadProcessingJobById: (...args: unknown[]) => mockProcessJobById(...args),
}));

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  insert: (...args: unknown[]) => mockLocalInsert(...args),
  update: (...args: unknown[]) => mockLocalUpdate(...args),
  getAll: (...args: unknown[]) => mockGetAll(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  }),
}));

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/upload/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-1',
    uploadId: 'upload-1',
    key: 'audio/beat.wav',
    fileName: 'beat.wav',
    fileSize: 1024,
    contentType: 'audio/wav',
    partSize: 1024,
    totalParts: 1,
    parts: [{ PartNumber: 1, ETag: 'etag-1' }],
    type: 'beat',
    projectId: null,
    replaceTrackId: null,
    userId: 'user-1',
    status: 'in_progress',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const mockTrackDeleteEq = vi.fn<(...args: unknown[]) => Promise<{ error: { message: string } | null }>>(() => Promise.resolve({ error: null }));
let trackInsertResult: { data: unknown; error: { message: string } | null } = { data: { id: 'track-1', title: 'Beat' }, error: null };

function supabaseTable(table: string) {
  if (table === 'tracks') {
    return {
      insert: vi.fn(() => ({
        select: () => ({
          single: () => Promise.resolve(trackInsertResult),
        }),
      })),
      delete: () => ({ eq: (...args: unknown[]) => mockTrackDeleteEq(...args) }),
    };
  }
  if (table === 'projects') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    };
  }
  if (table === 'playlists') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    };
  }
  if (table === 'project_tracks' || table === 'playlist_tracks') {
    return {
      insert: vi.fn(() => Promise.resolve({ error: null })),
    };
  }
  return {};
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyStoredAudio.mockResolvedValue({ ok: true });
  mockDeleteStoredObject.mockResolvedValue(undefined);
  trackInsertResult = { data: { id: 'track-1', title: 'Beat' }, error: null };
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockGetSession.mockReturnValue(session());
  mockCompleteMultipart.mockResolvedValue('https://cdn.example.test/beat.wav');
  mockListParts.mockImplementation(async () => mockGetSession()?.parts ?? []);
  mockReadAssembledBuffer.mockRejectedValue(new Error('skip analysis fetch'));
  mockAnalyzeAudio.mockResolvedValue({ bpm: null, key: null, scale: null, loudness: null, duration: null });
  mockGetAuddFeatures.mockResolvedValue({ danceability: 0, energy: 0, valence: 0, acousticness: 0, tempo: 0 });
  mockMergeFeatures.mockReturnValue({
    bpm: null,
    key: null,
    scale: null,
    loudness: null,
    duration_seconds: null,
    energy: null,
    danceability: null,
    valence: null,
    acousticness: null,
  });
  mockExtractPeaks.mockResolvedValue(null);
  mockUploadPeaksSidecar.mockResolvedValue(null);
  mockUploadPublicPreview.mockResolvedValue(null);
  mockEnqueueUploadProcessingJob.mockResolvedValue('job-1');
  mockProcessJobById.mockResolvedValue({ id: 'job-1', trackId: 'track-1', ok: true });
  afterCallbacks.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockFrom.mockImplementation((table: string) => supabaseTable(table));
});

describe('POST /api/upload/complete — local no-database mode', () => {
  it('writes the track to the local store and never touches Supabase', async () => {
    mockIsSupabaseConfigured.mockReturnValue(false);
    mockLocalInsert.mockReturnValue({ id: 'local-1', title: 'Beat' });
    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, track: { id: 'local-1' } });
    expect(mockLocalInsert).toHaveBeenCalledWith('tracks', expect.objectContaining({ audio_url: expect.any(String) }));
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockDeleteSession).toHaveBeenCalledWith('sess-1');
  });
});

describe('POST /api/upload/complete — failure cleanup', () => {
  it('removes the half-created track and the object when the destination attach fails', async () => {
    mockGetSession.mockReturnValueOnce(session({ projectId: 'missing-destination' }));
    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(404);
    expect(mockTrackDeleteEq).toHaveBeenCalledWith('id', 'track-1');
    expect(mockDeleteStoredObject).toHaveBeenCalledTimes(1);
    expect(mockMarkStatus).toHaveBeenLastCalledWith('sess-1', 'aborted');
    expect(mockEnqueueUploadProcessingJob).not.toHaveBeenCalled();
  });

  it('deletes the object when the track insert itself fails (no row to remove)', async () => {
    trackInsertResult = { data: null, error: { message: 'insert failed' } };
    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(500);
    expect(mockTrackDeleteEq).not.toHaveBeenCalled();
    expect(mockDeleteStoredObject).toHaveBeenCalledTimes(1);
    expect(mockMarkStatus).toHaveBeenLastCalledWith('sess-1', 'aborted');
  });

  it('keeps the object when the track row cannot be removed (it still references it)', async () => {
    mockGetSession.mockReturnValueOnce(session({ projectId: 'missing-destination' }));
    mockTrackDeleteEq.mockResolvedValueOnce({ error: { message: 'rls' } });
    const mod = await loadRoute();
    await mod.POST(post({ sessionId: 'sess-1' }));

    expect(mockDeleteStoredObject).not.toHaveBeenCalled();
  });

  it('never deletes anything once the track is committed, even if a later step fails', async () => {
    mockEnqueueUploadProcessingJob.mockRejectedValueOnce(new Error('queue down'));
    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(500);
    expect(mockTrackDeleteEq).not.toHaveBeenCalled();
    expect(mockDeleteStoredObject).not.toHaveBeenCalled();
  });

  it('returns the original error even when cleanup itself throws', async () => {
    trackInsertResult = { data: null, error: { message: 'insert failed' } };
    mockDeleteStoredObject.mockRejectedValueOnce(new Error('r2 down'));
    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toContain('insert failed');
  });
});

describe('POST /api/upload/complete', () => {
  it('rejects an assembled object that is not audio, before any track row', async () => {
    mockVerifyStoredAudio.mockResolvedValueOnce({ ok: false, format: 'unknown' });

    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(415);
    expect(mockMarkStatus).toHaveBeenCalledWith('sess-1', 'aborted');
    expect(mockFrom).not.toHaveBeenCalledWith('tracks');
    expect(mockLocalInsert).not.toHaveBeenCalled();
    expect(mockEnqueueUploadProcessingJob).not.toHaveBeenCalled();
  });

  it('409s when not every part has arrived', async () => {
    mockGetSession.mockReturnValueOnce(session({ totalParts: 2 }));

    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Missing parts (1/2)' });
    expect(mockCompleteMultipart).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown upload destination and does not fall back to local-store success', async () => {
    mockGetSession.mockReturnValueOnce(session({ projectId: 'missing-destination' }));

    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Upload destination not found' });
    expect(mockLocalInsert).not.toHaveBeenCalled();
    expect(mockLocalUpdate).not.toHaveBeenCalled();
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('attaches an owned project destination and returns the created track', async () => {
    const projectTracksInsert = vi.fn(() => Promise.resolve({ error: null }));
    mockGetSession.mockReturnValueOnce(session({ projectId: 'project-1' }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: 'project-1', user_id: 'user-1' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'project_tracks') {
        return { insert: projectTracksInsert };
      }
      return supabaseTable(table);
    });

    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(200);
    expect(projectTracksInsert).toHaveBeenCalledWith({
      project_id: 'project-1',
      track_id: 'track-1',
      role: 'main',
      position: 0,
    });
    expect(mockEnqueueUploadProcessingJob).toHaveBeenCalledWith({
      trackId: 'track-1',
      userId: 'user-1',
      audioUrl: 'https://cdn.example.test/beat.wav',
      fileName: 'beat.wav',
      clientAnalysis: null,
    });
    expect(mockDeleteSession).toHaveBeenCalledWith('sess-1');
    expect(afterCallbacks).toHaveLength(1);
    expect(mockProcessJobById).not.toHaveBeenCalled();
    await afterCallbacks[0]();
    expect(mockProcessJobById).toHaveBeenCalledWith('job-1');
    expect(await res.json()).toEqual({
      success: true,
      track: { id: 'track-1', title: 'Beat' },
      processing: 'queued',
    });
  });

  it('does not throw from after() when immediate processing fails', async () => {
    mockGetSession.mockReturnValueOnce(session({}));
    mockProcessJobById.mockRejectedValueOnce(new Error('R2 unavailable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(200);
    expect(afterCallbacks).toHaveLength(1);
    await expect(Promise.resolve(afterCallbacks[0]())).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('applies the BPM and key written in the filename, and cuts them from the title', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    mockGetSession.mockReturnValueOnce(session({ fileName: 'Night Shift 140 Fm.wav' }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tracks') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'track-1' }, error: null }) }) };
          },
        };
      }
      return supabaseTable(table);
    });

    const mod = await loadRoute();
    const res = await mod.POST(post({ sessionId: 'sess-1' }));

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ title: 'Night Shift' });
    // The filename is handed to the merge as the highest-precedence source.
    expect(mockMergeFeatures).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.objectContaining({ bpm: 140, key: 'F', scale: 'minor' }) }),
    );
  });
});
