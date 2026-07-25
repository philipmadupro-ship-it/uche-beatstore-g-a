import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCoverAttachOptions, normalizeCoverAttachOptions } from './cover-attach-options';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('cover attach options', () => {
  it('normalizes paged track responses', () => {
    expect(normalizeCoverAttachOptions('track', {
      tracks: [
        { id: 't-1', title: 'Night Run', type: 'beat', bpm: 144, key: 'F minor', duration_seconds: 128, peaks_url: '/peaks.json', cover_url: '/cover.webp' },
        { id: '', title: 'Missing id' },
      ],
    })).toEqual([
      {
        id: 't-1',
        label: 'Night Run',
        detail: 'beat / 144 BPM / F minor',
        coverUrl: '/cover.webp',
        bpm: 144,
        musicalKey: 'F minor',
        durationSeconds: 128,
        peaksUrl: '/peaks.json',
      },
    ]);
  });

  it('normalizes project and playlist response envelopes', () => {
    expect(normalizeCoverAttachOptions('project', { projects: [{ id: 'p-1', name: 'Tape One', track_count: 7 }] })).toEqual([
      { id: 'p-1', label: 'Tape One', detail: '7 tracks', coverUrl: null, bpm: null, musicalKey: null, durationSeconds: null, peaksUrl: null },
    ]);
    expect(normalizeCoverAttachOptions('playlist', { playlists: [{ id: 'pl-1', name: 'Outreach', track_count: 1 }] })).toEqual([
      { id: 'pl-1', label: 'Outreach', detail: '1 track', coverUrl: null, bpm: null, musicalKey: null, durationSeconds: null, peaksUrl: null },
    ]);
  });

  it('returns profile without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCoverAttachOptions('profile')).resolves.toEqual([
      { id: 'profile', label: 'Profile hero', detail: 'Creator profile' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches kind-specific options with limits', async () => {
    const fetchMock = mockFetch({ ok: true, body: { projects: [{ id: 'project 1', name: 'Archive' }] } });

    await expect(fetchCoverAttachOptions('project', 12)).resolves.toEqual([
      { id: 'project 1', label: 'Archive', coverUrl: null, bpm: null, musicalKey: null, durationSeconds: null, peaksUrl: null },
    ]);

    expect(fetchMock).toHaveBeenCalledWith('/api/projects?limit=12', { cache: 'no-store' });
  });

  it('surfaces API errors safely', async () => {
    mockFetch({ ok: false, status: 401, body: { error: 'Unauthorized' } });

    await expect(fetchCoverAttachOptions('track')).rejects.toThrow('Unauthorized');
  });
});
