/**
 * Route tests for /api/tracks/[id]/analyze.
 *
 * Reliability contract:
 * - malformed JSON returns a clear 400
 * - tracks with no source audio return a clear 400
 * - chord-only client payloads persist without running the full decode path
 * - usable client features can update analysis fields without fetching audio
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockGetById = vi.fn();
const mockUpdate = vi.fn();
const mockRequireRowOwnership = vi.fn();
const mockAnalyzeAudio = vi.fn();
const mockGetAuddFeatures = vi.fn();
const mockMergeFeatures = vi.fn();

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'http://localhost:3000' }));

vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getById: (...args: unknown[]) => mockGetById(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  requireRowOwnership: (...args: unknown[]) => mockRequireRowOwnership(...args),
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

function req(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tracks/track-1/analyze', {
    method: 'POST',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function rawReq(body: string): NextRequest {
  return new NextRequest('http://localhost/api/tracks/track-1/analyze', {
    method: 'POST',
    body,
  });
}

function ctx(id = 'track-1') {
  return { params: Promise.resolve({ id }) };
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_AUDD_API_TOKEN;
  mockIsSupabaseConfigured.mockReturnValue(false);
  mockGetById.mockReturnValue({ id: 'track-1', title: 'Beat', audio_url: 'https://cdn.example.test/beat.wav' });
  mockUpdate.mockImplementation((_table, id, patch) => ({ id, ...patch }));
  mockMergeFeatures.mockReturnValue({
    bpm: 142,
    key: 'F#',
    scale: 'minor',
    loudness: -8,
    duration_seconds: 124,
    energy: null,
    danceability: null,
    valence: null,
    acousticness: null,
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_AUDD_API_TOKEN;
});

describe('POST /api/tracks/[id]/analyze', () => {
  it('400s when the request body is malformed JSON', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(rawReq('{bad json'), ctx());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Malformed JSON body. Send `{}` or `{features: {...}}`.',
    });
    expect(mockAnalyzeAudio).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('400s when the track has no source audio URL', async () => {
    mockGetById.mockReturnValueOnce({ id: 'track-1', title: 'Beat', audio_url: null });

    const mod = await loadRoute();
    const res = await mod.POST(req(), ctx());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No audio_url on track' });
    expect(mockAnalyzeAudio).not.toHaveBeenCalled();
  });

  it('persists chord-only client payloads without running full audio analysis', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(req({
      chords: [
        { time: -1, chord: 'Cmaj7 extra long' },
        { time: 3.2, chord: 'F#m' },
        { time: Number.NaN, chord: 'bad' },
      ],
    }), ctx());

    expect(res.status).toBe(200);
    expect(mockAnalyzeAudio).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith('tracks', 'track-1', {
      chords: [
        { time: 0, chord: 'Cmaj7 ex' },
        { time: 3.2, chord: 'F#m' },
      ],
    });
    expect(await res.json()).toEqual({
      track: {
        id: 'track-1',
        chords: [
          { time: 0, chord: 'Cmaj7 ex' },
          { time: 3.2, chord: 'F#m' },
        ],
      },
      source: 'client',
      chords_saved: 2,
    });
  });

  it('updates usable client features without fetching audio or running server analysis', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(req({
      features: { bpm: 142.4, key: 'F#', scale: 'minor', loudness: -8.2, duration: 124.2 },
    }), ctx());

    expect(res.status).toBe(200);
    expect(mockAnalyzeAudio).not.toHaveBeenCalled();
    expect(mockGetAuddFeatures).not.toHaveBeenCalled();
    expect(mockMergeFeatures).toHaveBeenCalledWith({
      client: { bpm: 142.4, key: 'F#', scale: 'minor', loudness: -8.2, duration: 124.2 },
      server: null,
      audd: null,
    });
    expect(mockUpdate).toHaveBeenCalledWith('tracks', 'track-1', {
      bpm: 142,
      key: 'F#',
      scale: 'minor',
      loudness: -8,
      duration_seconds: 124,
    });
    const body = await res.json();
    expect(body.source).toBe('client');
    expect(body.track.bpm).toBe(142);
  });
});
