/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockRequireUser = vi.fn();
const queryCalls: Array<{ table: string; operation: 'eq' | 'in'; column: string; value: unknown }> = [];

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  requireUser: () => mockRequireUser(),
  getAll: vi.fn(),
}));

type RowsByTable = Record<string, any[]>;

function adminClient(rows: RowsByTable) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              queryCalls.push({ table, operation: 'eq', column, value });
              return Promise.resolve({
                data: (rows[table] ?? []).filter((row) => row[column] === value),
                error: null,
              });
            },
            in(column: string, values: unknown[]) {
              queryCalls.push({ table, operation: 'in', column, value: values });
              return Promise.resolve({
                data: (rows[table] ?? []).filter((row) => values.includes(row[column])),
                error: null,
              });
            },
          };
        },
      };
    },
  };
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  queryCalls.length = 0;
  mockIsSupabaseConfigured.mockReturnValue(true);
});

describe('GET /api/links', () => {
  it('chunks id filters so a large catalogue does not blow the query string', async () => {
    // PostgREST puts `.in()` filters in the URL. One filter over ~650 track
    // ids is ~24KB and comes back as a bare "Bad Request", which the page
    // renders as "no share links yet" — an empty account, not a failure.
    const tracks = Array.from({ length: 250 }, (_, i) => ({
      id: `track-${i}`,
      user_id: 'owner-1',
      title: `T${i}`,
      type: 'beat',
      cover_url: null,
    }));
    const rows: RowsByTable = {
      share_links: [],
      projects: [],
      playlists: [],
      tracks,
      track_tags: [],
      project_shares: [],
      project_tracks: [],
      playlist_tracks: [],
    };
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'owner-1', admin: adminClient(rows) });

    const route = await loadRoute();
    const res = await route.GET();
    expect(res.status).toBe(200);

    const trackIdFilters = queryCalls.filter(
      (call) => call.operation === 'in' && call.column === 'track_id',
    );
    expect(trackIdFilters.length).toBeGreaterThan(2);
    for (const call of trackIdFilters) {
      expect((call.value as unknown[]).length).toBeLessThanOrEqual(100);
    }
    // Chunking must not lose rows: every id still gets asked about.
    const asked = new Set(
      trackIdFilters
        .filter((call) => call.table === 'project_shares')
        .flatMap((call) => call.value as string[]),
    );
    expect(asked.size).toBe(250);
  });

  it('requires an authenticated owner', async () => {
    mockRequireUser.mockResolvedValue({
      ok: false,
      res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const route = await loadRoute();
    const res = await route.GET();

    expect(res.status).toBe(401);
    expect(queryCalls).toEqual([]);
  });

  it('merges legacy and project shares with their correct public paths', async () => {
    const rows: RowsByTable = {
      share_links: [
        {
          id: 'legacy-1',
          user_id: 'owner-1',
          token: 'legacy-token',
          title: 'Direct send',
          kind: 'track',
          track_ids: ['track-1'],
          plays: 4,
          expires_at: null,
          revoked_at: null,
          allow_downloads: true,
          password_hash: 'secret-hash',
          created_at: '2026-06-01T00:00:00Z',
          audio_url: 'https://protected.example/raw.mp3',
        },
      ],
      projects: [{ id: 'project-1', user_id: 'owner-1', name: 'Midnight Tape' }],
      playlists: [],
      tracks: [
        { id: 'track-1', user_id: 'owner-1', title: 'Static', type: 'beat', audio_url: 'https://protected.example/raw.mp3' },
      ],
      project_shares: [
        {
          id: 'project-share-1',
          token: 'project-token',
          content_type: 'project',
          project_id: 'project-1',
          playlist_id: null,
          track_id: null,
          label: null,
          plays: 7,
          expires_at: null,
          revoked_at: null,
          allow_downloads: false,
          password_hash: null,
          created_at: '2026-06-02T00:00:00Z',
        },
      ],
      project_tracks: [{ project_id: 'project-1', track_id: 'track-1', position: 0 }],
      playlist_tracks: [],
    };
    mockRequireUser.mockResolvedValue({
      ok: true,
      userId: 'owner-1',
      admin: adminClient(rows),
    });

    const route = await loadRoute();
    const res = await route.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.links).toEqual([
      expect.objectContaining({
        id: 'project-share-1',
        source: 'project_shares',
        title: 'Midnight Tape',
        href: '/projects/share/project-token',
        track_ids: ['track-1'],
      }),
      expect.objectContaining({
        id: 'legacy-1',
        source: 'share_links',
        title: 'Direct send',
        href: '/share/legacy-token',
        password_protected: true,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('password_hash');
    expect(JSON.stringify(body)).not.toContain('audio_url');
    expect(JSON.stringify(body)).not.toContain('protected.example');
  });

  it('carries artwork the page can fall back on: cover, kind and a subject-stable seed', async () => {
    const rows: RowsByTable = {
      share_links: [
        {
          id: 'legacy-1',
          user_id: 'owner-1',
          token: 'legacy-token',
          kind: 'track',
          track_ids: ['track-1'],
          created_at: '2026-06-03T00:00:00Z',
        },
      ],
      projects: [{ id: 'project-1', user_id: 'owner-1', name: 'Midnight Tape', cover_url: null }],
      playlists: [],
      tracks: [
        { id: 'track-1', user_id: 'owner-1', title: 'Static', type: 'beat', cover_url: 'https://cdn/static.jpg' },
      ],
      track_tags: [
        { track_id: 'track-1', tag: 'Chill', category: 'mood' },
        { track_id: 'track-1', tag: 'Drill', category: 'genre' },
        { track_id: 'track-1', tag: '808s', category: 'instrument' },
      ],
      project_shares: [
        {
          id: 'project-share-1',
          token: 'project-token',
          content_type: 'project',
          project_id: 'project-1',
          created_at: '2026-06-02T00:00:00Z',
        },
      ],
      project_tracks: [{ project_id: 'project-1', track_id: 'track-1', position: 0 }],
      playlist_tracks: [],
    };
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'owner-1', admin: adminClient(rows) });

    const route = await loadRoute();
    const body = await (await route.GET()).json();
    const byId = Object.fromEntries(body.links.map((link: any) => [link.id, link]));

    // A coverless project borrows its first track's art rather than showing
    // nothing, and asks for the PROJECT default-artwork slot.
    expect(byId['project-share-1']).toMatchObject({
      cover_url: 'https://cdn/static.jpg',
      artwork_kind: 'project',
      // Seeded on the project, not the share: two links to one project must
      // generate the same gradient.
      artwork_seed: 'project-1',
      artwork_tags: ['Drill', 'Chill'],
    });
    expect(byId['legacy-1']).toMatchObject({
      artwork_kind: 'track',
      artwork_seed: 'track-1',
    });
    expect(byId['legacy-1'].tracks[0]).toMatchObject({ cover_url: 'https://cdn/static.jpg' });
    // instrument/status tags do not steer the gradient.
    expect(byId['legacy-1'].artwork_tags).not.toContain('808s');
  });

  it('scopes modern shares through content owned by the authenticated user', async () => {
    const rows: RowsByTable = {
      share_links: [],
      projects: [
        { id: 'project-owned', user_id: 'owner-1', name: 'Owned' },
        { id: 'project-other', user_id: 'owner-2', name: 'Other' },
      ],
      playlists: [],
      tracks: [],
      project_shares: [
        { id: 'share-owned', project_id: 'project-owned', content_type: 'project', token: 'owned', created_at: '2026-06-01T00:00:00Z' },
        { id: 'share-other', project_id: 'project-other', content_type: 'project', token: 'other', created_at: '2026-06-01T00:00:00Z' },
      ],
      project_tracks: [],
      playlist_tracks: [],
    };
    mockRequireUser.mockResolvedValue({
      ok: true,
      userId: 'owner-1',
      admin: adminClient(rows),
    });

    const route = await loadRoute();
    const res = await route.GET();
    const body = await res.json();

    expect(body.links.map((link: any) => link.id)).toEqual(['share-owned']);
    expect(queryCalls).toContainEqual({
      table: 'projects',
      operation: 'eq',
      column: 'user_id',
      value: 'owner-1',
    });
    expect(queryCalls).toContainEqual({
      table: 'project_shares',
      operation: 'in',
      column: 'project_id',
      value: ['project-owned'],
    });
  });
});
