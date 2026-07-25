import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCoverUrl } from './cover-attachment';

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

describe('cover attachment helper', () => {
  it('patches generated covers onto tracks', async () => {
    const fetchMock = mockFetch({ ok: true, body: { track: { id: 'track-1' } } });

    await expect(attachCoverUrl({ kind: 'track', id: 'track-1' }, '/uploads/covers/generated.webp')).resolves.toEqual({
      track: { id: 'track-1' },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/tracks/track-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_url: '/uploads/covers/generated.webp' }),
    });
  });

  it('patches generated covers onto projects and playlists', async () => {
    const fetchMock = mockFetch({ ok: true, body: { success: true } });

    await attachCoverUrl({ kind: 'project', id: 'project 1' }, 'https://cdn.example.test/cover.webp');
    await attachCoverUrl({ kind: 'playlist', id: 'playlist-1' }, 'https://cdn.example.test/cover.webp');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/projects/project%201', expect.objectContaining({
      body: JSON.stringify({ cover_url: 'https://cdn.example.test/cover.webp' }),
      method: 'PATCH',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/playlists/playlist-1', expect.objectContaining({
      body: JSON.stringify({ cover_url: 'https://cdn.example.test/cover.webp' }),
      method: 'PATCH',
    }));
  });

  it('saves generated covers as the profile hero image', async () => {
    const fetchMock = mockFetch({ ok: true, body: { profile: { hero_image_url: '/cover.webp' } } });

    await attachCoverUrl({ kind: 'profile' }, '/cover.webp');

    expect(fetchMock).toHaveBeenCalledWith('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hero_image_url: '/cover.webp' }),
    });
  });

  it('requires target ids and uploaded URLs before attaching', async () => {
    await expect(attachCoverUrl({ kind: 'track', id: ' ' }, '/cover.webp')).rejects.toThrow('Choose a target before attaching the cover.');
    await expect(attachCoverUrl({ kind: 'profile' }, ' ')).rejects.toThrow('Upload a generated cover before attaching it.');
  });

  it('surfaces safe API errors', async () => {
    mockFetch({ ok: false, status: 403, body: { error: 'Forbidden' } });

    await expect(attachCoverUrl({ kind: 'playlist', id: 'playlist-1' }, '/cover.webp')).rejects.toThrow('Forbidden');
  });
});
