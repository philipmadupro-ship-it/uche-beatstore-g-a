/**
 * Route tests for /api/upload/complete.
 *
 * Reliability contract:
 * - missing chunks fail before storage finalize
 * - destination attach failures return errors instead of falling back to local-store success
 * - owned project destinations attach the new track and complete successfully
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

vi.mock('@/lib/storage/upload', () => ({
  uploadPeaksSidecar: (...args: unknown[]) => mockUploadPeaksSidecar(...args),
  uploadPublicPreview: (...args: unknown[]) => mockUploadPublicPreview(...args),
}));

vi.mock('@/lib/upload/processing', () => ({
  enqueueUploadProcessingJob: (...args: unknown[]) => mockEnqueueUploadProcessingJob(...args),
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

function supabaseTable(table: string) {
  if (table === 'tracks') {
    return {
      insert: vi.fn(() => ({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'track-1', title: 'Beat' }, error: null }),
        }),
      })),
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
  mockEnqueueUploadProcessingJob.mockResolvedValue(undefined);
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockFrom.mockImplementation((table: string) => supabaseTable(table));
});

describe('POST /api/upload/complete', () => {
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
    expect(await res.json()).toEqual({
      success: true,
      track: { id: 'track-1', title: 'Beat' },
      processing: 'queued',
    });
  });
});
