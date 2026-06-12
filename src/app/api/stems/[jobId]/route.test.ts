/**
 * Route tests for /api/stems/[jobId].
 *
 * Reliability contract:
 * - completed extraction with missing durable core stems is marked failed,
 *   not completed
 * - local track.stems_status follows the stem job status
 * - successful core stem storage returns completed with durable URLs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPollJob = vi.fn();
const mockDownloadStem = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockGetAll = vi.fn();
const mockUpdate = vi.fn();
const mockGetById = vi.fn();
const mockCreateServiceClient = vi.fn();
const mockUploadAudio = vi.fn();
const mockAutoDeliverStems = vi.fn();

vi.mock('@/lib/stems/dispatch', () => ({
  pollJob: (...args: unknown[]) => mockPollJob(...args),
  downloadStem: (...args: unknown[]) => mockDownloadStem(...args),
}));

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getAll: (...args: unknown[]) => mockGetAll(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  getById: (...args: unknown[]) => mockGetById(...args),
  createServiceClient: (...args: unknown[]) => mockCreateServiceClient(...args),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadAudio: (...args: unknown[]) => mockUploadAudio(...args),
}));

vi.mock('@/lib/stems/auto-deliver', () => ({
  autoDeliverStems: (...args: unknown[]) => mockAutoDeliverStems(...args),
}));

function req(): NextRequest {
  return new NextRequest('http://localhost/api/stems/job-1');
}

function ctx(jobId = 'job-1') {
  return { params: Promise.resolve({ jobId }) };
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSupabaseConfigured.mockReturnValue(false);
  mockGetAll.mockImplementation((table: string) => {
    if (table === 'stems') return [{ id: 'stem-row-1', track_id: 'track-1', job_id: 'job-1' }];
    return [];
  });
  mockGetById.mockReturnValue({ id: 'track-1', title: 'Night Drive' });
  mockDownloadStem.mockResolvedValue(Buffer.from('stem-data'));
  mockUploadAudio.mockImplementation(async (_buffer, filename: string) => `https://cdn.example.test/${filename}`);
});

describe('GET /api/stems/[jobId]', () => {
  it('marks the job and parent track failed when a completed extraction is missing core stems', async () => {
    mockPollJob.mockResolvedValueOnce({
      status: 'done',
      progress: 100,
      model: 'demucs',
      stems: { vocals: 'remote-vocals.wav' },
    });

    const mod = await loadRoute();
    const res = await mod.GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('stems', 'stem-row-1', {
      status: 'failed',
      vocals_url: expect.stringContaining('Vocals.wav'),
      drums_url: null,
      bass_url: null,
      other_url: null,
    });
    expect(mockUpdate).toHaveBeenCalledWith('tracks', 'track-1', { stems_status: 'failed' });
    const body = await res.json();
    expect(body.job.status).toBe('failed');
    expect(body.job.error).toContain('one or more stems could not be stored');
  });

  it('marks local stems and parent track done when all core stems are durable', async () => {
    mockPollJob.mockResolvedValueOnce({
      status: 'done',
      progress: 100,
      model: 'demucs',
      stems: {
        vocals: 'remote-vocals.wav',
        drums: 'remote-drums.wav',
        bass: 'remote-bass.wav',
        other: 'remote-other.wav',
      },
    });

    const mod = await loadRoute();
    const res = await mod.GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('stems', 'stem-row-1', {
      status: 'done',
      vocals_url: expect.stringContaining('Vocals.wav'),
      drums_url: expect.stringContaining('Drums.wav'),
      bass_url: expect.stringContaining('Bass.wav'),
      other_url: expect.stringContaining('Other.wav'),
    });
    expect(mockUpdate).toHaveBeenCalledWith('tracks', 'track-1', { stems_status: 'done' });
    const body = await res.json();
    expect(body.job.status).toBe('completed');
    expect(Object.keys(body.job.stems).sort()).toEqual(['bass', 'drums', 'other', 'vocals']);
  });
});
