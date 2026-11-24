/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireUser = vi.fn();
const mockConfigured = vi.fn();
vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockConfigured(),
  requireUser: () => mockRequireUser(),
}));

const OWNER = 'owner-1';
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C1 = U(1), C2 = U(2), FOREIGN_C = U(3);
const T1 = U(11), T2 = U(12), T3 = U(13), FOREIGN_T = U(14);
const P1 = U(21);
const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

type Rows = Record<string, any[]>;
const filters: Array<{ table: string; col: string; val: unknown }> = [];

function admin(rows: Rows, opts: { eventsError?: any } = {}) {
  return {
    from(table: string) {
      let data = rows[table] ?? [];
      const q: any = {
        select: () => q,
        order: () => q,
        range: (a: number, b: number) => { data = data.slice(a, b + 1); return q; },
        gte: (col: string, val: string) => { data = data.filter((r) => r[col] >= val); return q; },
        eq: (col: string, val: unknown) => {
          filters.push({ table, col, val });
          if (table === 'project_shares' && col === 'user_id') throw new Error('project_shares has no user_id');
          if (table === 'beat_sends' && col === 'user_id') throw new Error('beat_sends has no user_id');
          data = data.filter((r) => r[col] === val);
          return q;
        },
        in: (col: string, vals: unknown[]) => { data = data.filter((r) => vals.includes(r[col])); return q; },
        maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
        then: (res: (v: unknown) => void) =>
          res(table === 'share_events' && opts.eventsError ? { data: null, error: opts.eventsError } : { data, error: null }),
      };
      return q;
    },
  };
}

const req = (body: unknown) =>
  new NextRequest('http://x/api/beat_sends/duplicates', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const load = () => import('./route');
const auth = (rows: Rows, o?: any) => mockRequireUser.mockResolvedValue({ ok: true, userId: OWNER, admin: admin(rows, o) });

const base = (): Rows => ({
  tracks: [
    { id: T1, title: 'Night Shift', user_id: OWNER },
    { id: T2, title: 'Cold Front', user_id: OWNER },
    { id: T3, title: 'Late Add', user_id: OWNER },
    { id: FOREIGN_T, title: 'Theirs', user_id: 'other' },
  ],
  contacts: [
    { id: C1, user_id: OWNER, email: 'nova@x.com' },
    { id: C2, user_id: OWNER, email: 'kai@x.com' },
    { id: FOREIGN_C, user_id: 'other', email: 'spy@x.com' },
  ],
  beat_sends: [
    { contact_id: C1, track_ids: [T1], share_token: 'tokA', sent_at: daysAgo(3), opened_at: daysAgo(3), link_clicked_at: null },
    { contact_id: FOREIGN_C, track_ids: [T1], share_token: 'tokF', sent_at: daysAgo(3) },
  ],
  project_shares: [],
  projects: [{ id: P1, user_id: OWNER }],
  project_tracks: [{ project_id: P1, track_id: T1 }, { project_id: P1, track_id: T3 }],
  share_links: [{ id: U(31), token: 'tokA', user_id: OWNER }],
  share_events: [
    { owner_user_id: OWNER, share_id: U(31), kind: 'open' },
    { owner_user_id: OWNER, share_id: U(31), kind: 'play' },
    { owner_user_id: OWNER, share_id: U(31), kind: 'play' },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  mockConfigured.mockReturnValue(true);
});

describe('POST /api/beat_sends/duplicates', () => {
  it('401s without a session', async () => {
    mockRequireUser.mockResolvedValue({ ok: false, res: new Response('no', { status: 401 }) });
    expect((await (await load()).POST(req({ recipients: [{ contact_id: C1 }], track_ids: [T1] }))).status).toBe(401);
  });

  it('400s on a bad body: no tracks, empty or oversized recipients, bad ids', async () => {
    auth(base());
    const { POST } = await load();
    expect((await POST(req({ recipients: [{ contact_id: C1 }] }))).status).toBe(400);
    expect((await POST(req({ recipients: [], track_ids: [T1] }))).status).toBe(400);
    expect((await POST(req({ recipients: [{}], track_ids: [T1] }))).status).toBe(400);
    expect((await POST(req({ recipients: [{ contact_id: 'nope' }], track_ids: [T1] }))).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ email: `p${i}@x.com` }));
    expect((await POST(req({ recipients: many, track_ids: [T1] }))).status).toBe(400);
  });

  it('reports the overlap with titles, date and outcome including share_events', async () => {
    auth(base());
    const res = await (await load()).POST(req({ recipients: [{ contact_id: C1 }, { contact_id: C2 }], track_ids: [T1, T2] }));
    const { duplicates } = await res.json();
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      key: C1,
      tracks: [{ id: T1, title: 'Night Shift' }],
      email_opened: true,
      activity: { opens: 1, plays: 2, downloads: 0 },
    });
  });

  it('matches a typed email to a contact by normalised address', async () => {
    auth(base());
    const { duplicates } = await (await (await load()).POST(req({ recipients: [{ email: '  NOVA@x.com ' }], track_ids: [T1] }))).json();
    expect(duplicates.map((d: any) => d.key)).toEqual(['nova@x.com']);
  });

  it('never reads another account: foreign contacts, tracks and sends are invisible', async () => {
    auth(base());
    const { duplicates } = await (await (await load()).POST(req({ recipients: [{ contact_id: FOREIGN_C }, { email: 'spy@x.com' }], track_ids: [T1, FOREIGN_T] }))).json();
    expect(duplicates).toEqual([]);
    for (const table of ['tracks', 'contacts']) {
      expect(filters.some((f) => f.table === table && f.col === 'user_id' && f.val === OWNER)).toBe(true);
    }
  });

  it('a project being sent counts as its current tracks', async () => {
    auth(base());
    const { duplicates } = await (await (await load()).POST(req({ recipients: [{ contact_id: C1 }], project_id: P1 }))).json();
    expect(duplicates[0].tracks).toEqual([{ id: T1, title: 'Night Shift' }]);
  });

  it('an earlier project send covers the project\'s tracks added later', async () => {
    const rows = base();
    rows.beat_sends = [{ contact_id: C2, track_ids: [T1], share_token: 'tokP', sent_at: daysAgo(10), opened_at: null, link_clicked_at: null }];
    rows.project_shares = [{ id: U(41), token: 'tokP', project_id: P1, content_type: 'project' }];
    auth(rows);
    const { duplicates } = await (await (await load()).POST(req({ recipients: [{ contact_id: C2 }], track_ids: [T3] }))).json();
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].tracks).toEqual([{ id: T3, title: 'Late Add' }]);
  });

  it('does not expand a project share that belongs to someone else', async () => {
    const rows = base();
    rows.beat_sends = [{ contact_id: C2, track_ids: [T1], share_token: 'tokP', sent_at: daysAgo(10) }];
    rows.project_shares = [{ id: U(41), token: 'tokP', project_id: U(99), content_type: 'project' }];
    rows.project_tracks.push({ project_id: U(99), track_id: T3 });
    auth(rows);
    const { duplicates } = await (await (await load()).POST(req({ recipients: [{ contact_id: C2 }], track_ids: [T3] }))).json();
    expect(duplicates).toEqual([]);
  });

  it('ignores sends older than 90 days', async () => {
    const rows = base();
    rows.beat_sends[0].sent_at = daysAgo(120);
    auth(rows);
    const { duplicates } = await (await (await load()).POST(req({ recipients: [{ contact_id: C1 }], track_ids: [T1] }))).json();
    expect(duplicates).toEqual([]);
  });

  it('degrades silently before migration 203 (no share_events table)', async () => {
    auth(base(), { eventsError: { code: '42P01', message: 'relation "share_events" does not exist' } });
    const res = await (await load()).POST(req({ recipients: [{ contact_id: C1 }], track_ids: [T1] }));
    expect(res.status).toBe(200);
    const { duplicates } = await res.json();
    expect(duplicates[0]).toMatchObject({ key: C1, email_opened: true, activity: null });
  });

  it('a real read error is a 500, not a silent miss', async () => {
    auth(base(), { eventsError: { code: '57014', message: 'timeout' } });
    expect((await (await load()).POST(req({ recipients: [{ contact_id: C1 }], track_ids: [T1] }))).status).toBe(500);
  });
});
