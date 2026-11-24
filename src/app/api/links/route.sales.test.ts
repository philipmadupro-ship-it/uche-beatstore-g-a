/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

const mockRequireUser = vi.fn();
vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
  requireUser: () => mockRequireUser(),
  getAll: vi.fn(),
}));

function admin(rows: Record<string, any[]>) {
  const q = (table: string) => ({
    eq: (c: string, v: unknown) => Promise.resolve({ data: (rows[table] ?? []).filter((r) => r[c] === v), error: null }),
    in: (c: string, vs: unknown[]) => Promise.resolve({ data: (rows[table] ?? []).filter((r) => vs.includes(r[c])), error: null }),
  });
  return { from: (table: string) => ({ select: () => q(table) }) };
}

describe('GET /api/links — sales_enabled', () => {
  it('reports selling for both tables, null when the column is absent', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      userId: 'owner-1',
      admin: admin({
        share_links: [
          { id: 'l1', user_id: 'owner-1', token: 'a', kind: 'track', track_ids: [], sales_enabled: true, recipient_kind: 'rapper', created_at: '2026-06-01T00:00:00Z' },
          { id: 'l2', user_id: 'owner-1', token: 'b', kind: 'track', track_ids: [], created_at: '2026-06-02T00:00:00Z' },
        ],
        projects: [{ id: 'p1', user_id: 'owner-1', name: 'Tape' }],
        playlists: [],
        tracks: [],
        track_tags: [],
        project_shares: [
          { id: 's1', token: 'c', content_type: 'project', project_id: 'p1', sales_enabled: false, recipient_kind: 'friend', created_at: '2026-06-03T00:00:00Z' },
        ],
        project_tracks: [],
        playlist_tracks: [],
      }),
    });
    const { GET } = await import('./route');
    const body = await (await GET()).json();
    const byId = Object.fromEntries(body.links.map((l: any) => [l.id, l]));
    expect(byId.l1.sales_enabled).toBe(true);
    expect(byId.l2.sales_enabled).toBeNull();
    expect(byId.s1.sales_enabled).toBe(false);
    // The Settings form's Recipient dropdown reads this field straight off the row.
    expect(byId.l1.recipient_kind).toBe('rapper');
    expect(byId.s1.recipient_kind).toBe('friend');
  });
});
