import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockFrom = vi.fn();
const mockStreamAudioSource = vi.fn();

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioSource: (...args: unknown[]) => mockStreamAudioSource(...args),
}));

function req(format: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/store/download-file?session_id=cs_test&track_id=track-1&format=${format}`,
  );
}

function purchaseTable(lineItem: Record<string, unknown>, licenseType = 'lease') {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({
          data: {
            download_unlocked: true,
            license_type: licenseType,
            track_ids: ['track-1'],
            line_items: [lineItem],
          },
          error: null,
        }),
      }),
    }),
  };
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStreamAudioSource.mockResolvedValue(new NextResponse('audio'));
});

describe('GET /api/store/download-file', () => {
  it('rejects WAV and stems when the purchased tier only includes MP3', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'license_purchases') {
        return purchaseTable({
          track_id: 'track-1',
          license_id: 'custom-license',
          license_type: 'lease',
          file_types: ['MP3'],
          stems_included: false,
          is_exclusive: false,
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const mod = await loadRoute();
    const wavRes = await mod.GET(req('wav'));
    const stemRes = await mod.GET(req('drums'));

    expect(wavRes.status).toBe(403);
    expect(stemRes.status).toBe(403);
    expect(mockStreamAudioSource).not.toHaveBeenCalled();
  });

  it('allows WAV for a custom tier that includes WAV without granting stems', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'license_purchases') {
        return purchaseTable({
          track_id: 'track-1',
          license_id: 'custom-license',
          license_type: 'lease',
          file_types: ['MP3', 'WAV'],
          stems_included: false,
          is_exclusive: false,
        });
      }
      if (table === 'tracks') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  title: 'Tiered Beat',
                  audio_url: 'https://cdn.example.test/beat.mp3',
                  wav_url: 'https://cdn.example.test/beat.wav',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const mod = await loadRoute();
    const wavRes = await mod.GET(req('wav'));
    const stemRes = await mod.GET(req('drums'));

    expect(wavRes.status).toBe(200);
    expect(stemRes.status).toBe(403);
    expect(mockStreamAudioSource).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy exclusive rows compatible when entitlement fields are absent', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'license_purchases') {
        return purchaseTable({
          track_id: 'track-1',
          license_id: 'exclusive',
          license_type: 'exclusive',
        }, 'exclusive');
      }
      if (table === 'tracks') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  title: 'Legacy Beat',
                  audio_url: 'https://cdn.example.test/beat.mp3',
                  wav_url: 'https://cdn.example.test/beat.wav',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const mod = await loadRoute();
    const res = await mod.GET(req('wav'));

    expect(res.status).toBe(200);
    expect(mockStreamAudioSource).toHaveBeenCalledTimes(1);
  });

  it('does not stream a WAV-valued main file through an MP3-only entitlement', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'license_purchases') {
        return purchaseTable({
          track_id: 'track-1',
          license_id: 'custom-license',
          license_type: 'lease',
          file_types: ['MP3'],
          stems_included: false,
          is_exclusive: false,
        });
      }
      if (table === 'tracks') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  title: 'WAV Main Beat',
                  audio_url: 'https://cdn.example.test/beat.wav',
                  wav_url: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const mod = await loadRoute();
    const res = await mod.GET(req('mp3'));

    expect(res.status).toBe(403);
    expect(mockStreamAudioSource).not.toHaveBeenCalled();
  });

  describe('project bundle purchases', () => {
    function mockProject(expiresAt: string | null) {
      const one = (data: unknown) => ({ maybeSingle: () => Promise.resolve({ data, error: null }) });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'license_purchases') return { select: () => ({ eq: () => one(null) }) };
        if (table === 'project_access_links') {
          return { select: () => ({ eq: () => one({ project_id: 'proj-1', expires_at: expiresAt }) }) };
        }
        if (table === 'project_tracks') {
          return { select: () => ({ eq: () => ({ eq: () => one({ track_id: 'track-1' }) }) }) };
        }
        if (table === 'tracks') {
          return {
            select: () => ({
              eq: () => one({ title: 'Bundle Beat', audio_url: 'r2://priv/beat.mp3', wav_url: 'r2://priv/beat.wav' }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      });
    }

    it('denies an expired project access link, matching the token route', async () => {
      mockProject(new Date(Date.now() - 60_000).toISOString());
      const mod = await loadRoute();
      const res = await mod.GET(req('wav'));

      expect(res.status).toBe(404);
      expect(mockStreamAudioSource).not.toHaveBeenCalled();
    });

    it('still serves an unexpired or non-expiring project access link', async () => {
      mockProject(new Date(Date.now() + 60_000).toISOString());
      const mod = await loadRoute();
      expect((await mod.GET(req('wav'))).status).toBe(200);

      mockProject(null);
      expect((await mod.GET(req('mp3'))).status).toBe(200);
      expect(mockStreamAudioSource).toHaveBeenCalledTimes(2);
    });
  });
});
