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

    it('denies an expired (refunded, disputed or lapsed) project access link', async () => {
      mockProject(new Date(Date.now() - 60_000).toISOString());
      const mod = await loadRoute();
      const res = await mod.GET(req('wav'));

      expect(res.status).toBe(403);
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

describe('GET /api/store/download-file entitlement', () => {
  const mp3Lease = {
    track_id: 'track-1',
    license_id: 'lease',
    license_type: 'lease',
    file_types: ['MP3'],
    stems_included: false,
    is_exclusive: false,
  };

  function mockPurchase(
    purchase: Record<string, unknown> | null,
    opts: { error?: { message: string } | null } = {},
  ) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'license_purchases') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: purchase, error: opts.error ?? null }),
            }),
          }),
        };
      }
      if (table === 'project_access_links') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      if (table === 'tracks') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { title: 'Night Shift', audio_url: 'https://cdn.example.test/beat.mp3', wav_url: 'https://cdn.example.test/beat.wav' },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
  }

  const paid = {
    download_unlocked: true,
    needs_refund_review: false,
    license_type: 'lease',
    track_ids: ['track-1'],
    line_items: [mp3Lease],
  };

  it('streams the purchased file to the buyer who paid for it', async () => {
    mockPurchase(paid);
    const mod = await loadRoute();
    const res = await mod.GET(req('mp3'));

    expect(res.status).toBe(200);
    expect(mockStreamAudioSource).toHaveBeenCalledWith(
      expect.anything(),
      'https://cdn.example.test/beat.mp3',
      'Night Shift.mp3',
    );
  });

  it('refuses a refunded or disputed purchase', async () => {
    mockPurchase({ ...paid, download_unlocked: false });
    const mod = await loadRoute();
    const res = await mod.GET(req('mp3'));

    expect(res.status).toBe(403);
    expect(mockStreamAudioSource).not.toHaveBeenCalled();
  });

  it('holds the files of an exclusive that sold twice until the producer has reviewed it', async () => {
    // The webhook lets the second buyer's payment through, flags the row and
    // leaves download_unlocked true. Without this gate that buyer can pull the
    // WAV and stems of a beat whose exclusive rights belong to someone else.
    mockPurchase({
      ...paid,
      needs_refund_review: true,
      license_type: 'exclusive',
      line_items: [{ ...mp3Lease, license_type: 'exclusive', file_types: ['MP3', 'WAV', 'STEMS'], stems_included: true, is_exclusive: true }],
    });
    const mod = await loadRoute();
    const res = await mod.GET(req('wav'));

    expect(res.status).toBe(403);
    expect(mockStreamAudioSource).not.toHaveBeenCalled();
  });

  it('refuses a track that is not part of this purchase', async () => {
    mockPurchase({ ...paid, track_ids: ['someone-elses-track'] });
    const mod = await loadRoute();
    const res = await mod.GET(req('mp3'));

    expect(res.status).toBe(403);
    expect(mockStreamAudioSource).not.toHaveBeenCalled();
  });

  it('answers 404 for a session that matches no purchase and no bundle', async () => {
    mockPurchase(null);
    const mod = await loadRoute();
    const res = await mod.GET(req('mp3'));

    expect(res.status).toBe(404);
    expect(mockStreamAudioSource).not.toHaveBeenCalled();
  });

  it('answers 400 when the session or track is missing', async () => {
    const mod = await loadRoute();
    const noTrack = await mod.GET(new NextRequest('http://localhost/api/store/download-file?session_id=cs_test'));
    const noSession = await mod.GET(new NextRequest('http://localhost/api/store/download-file?track_id=track-1'));

    expect(noTrack.status).toBe(400);
    expect(noSession.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('reports a failed purchase lookup as a server error, not as "purchase not found"', async () => {
    mockPurchase(null, { error: { message: 'column needs_refund_review does not exist' } });
    const mod = await loadRoute();
    const res = await mod.GET(req('mp3'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('needs_refund_review');
  });
});

describe('GET /api/store/download-file errors', () => {
  it('does not echo internal error text to the buyer', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('relation "license_purchases" secret-internal-detail');
    });
    const mod = await loadRoute();
    const res = await mod.GET(req('mp3'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-internal-detail');
  });
});
