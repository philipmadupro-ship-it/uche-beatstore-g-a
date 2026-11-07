/**
 * GET /api/org/[orgId]/exec (LABEL-67), through the REAL lib/auth/org-access, exec-dashboard(-store) and
 * activity, against an in-memory database that evaluates filters. Faked: the release board's gate evaluation
 * (LABEL-32/33, tested there) and the finance loaders' tables (LABEL-64); the money rules run for real.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1 Nova's project with songs S1 (selected) and S3 (inbox);
 *     LP2 Kilo's Inbox with S2 (selected, only Kilo's). Releases R1 (Nova, blocked, April), R2 (Kilo, awaiting
 *     approval, May). Members: OWN (owner), EXEC (executive), EXN (executive scoped to Nova), FIN (finance),
 *     AR (A&R), ART (roster artist). L2: owner X.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const EXEC = u(2);
const EXN = u(3);
const FIN = u(4);
const AR = u(5);
const ART = u(6);
const X = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const S3 = t(3);
const R1 = '60000000-0000-4000-8000-000000000001';
const R2 = '60000000-0000-4000-8000-000000000002';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let auditFails = false;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '127.0.0.1', rateLimit: () => true }));
vi.mock('@/lib/labelos/activity', async (orig) => {
  const real = await orig<typeof import('@/lib/labelos/activity')>();
  return {
    ...real,
    recordEvent: (...args: Parameters<typeof real.recordEvent>) => {
      if (auditFails && args[2] === 'exec.exported') throw new real.AuditEventError(args[2], 'insert failed');
      return real.recordEvent(...args);
    },
  };
});

const gate = (g: string, status: string) => ({ gate: g, status, blockerCount: status === 'blocked' ? 1 : 0 });
const rel = (id: string, title: string, artistId: string, artistName: string, targetDate: string, gates: ReturnType<typeof gate>[]) => ({
  id, title, type: 'ep', state: 'draft', artistId, artistName, targetDate, releaseDate: null, deliveredAt: null, deliveredTo: null, itemCount: 1, gates, readyToDeliver: false, createdAt: '2026-10-01',
});
vi.mock('@/lib/labelos/release-board-store', () => ({
  // Mirrors the real store's scope narrowing: the member's artists only.
  loadReleaseBoard: async (access: { artistScope: ReadonlySet<string> | null }) => {
    const all = [
      rel(R1, 'Nova EP', C1, 'Nova', '2026-04-10', [gate('masters', 'blocked'), gate('legal', 'awaiting_approval')]),
      rel(R2, '=Kilo Tape', C2, 'Kilo', '2026-05-02', [gate('artwork', 'awaiting_approval')]),
    ];
    return { schemaReady: true, releases: access.artistScope === null ? all : all.filter((r) => access.artistScope!.has(r.artistId)), more: 0 };
  },
}));
vi.mock('@/lib/labelos/finance-dashboard-store', () => ({
  loadPositionFacts: async () => ({ payees: [], advances: [], allocations: [], recoupments: [], statements: [], payments: [] }),
  loadReleaseFacts: async () => ({
    releases: [{ id: R1, title: 'Nova EP', state: 'draft', upc: null, release_date: null, contact_id: C1 }],
    items: [{ release_id: R1, song_track_id: S1 }, { release_id: R1, song_track_id: S3 }],
    lines: [
      { id: 'l1', upc: null, song_track_id: S1, gross_minor: '90000', currency: 'USD' },
      { id: 'l2', upc: null, song_track_id: S3, gross_minor: '10000', currency: 'USD' },
      { id: 'l3', upc: null, song_track_id: S2, gross_minor: '500000', currency: 'USD' },
    ],
    royaltiesByLine: new Map(),
    spend: [],
  }),
}));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const song = (id: string, title: string, stage: string) => ({ id, org_id: L, user_id: null, type: 'song', title, song_stage: stage });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  auditFails = false;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', slug: 'label-one', deleted_at: null }, { id: L2, kind: 'label', slug: 'label-two', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(EXEC, 'member', ['executive']),
        member(EXN, 'member', ['executive'], 'artists'),
        member(FIN, 'member', ['finance']),
        member(AR, 'member', ['a_and_r']),
        member(ART, 'artist'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: EXN, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: S3, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
      ],
      tracks: [song(S1, 'Midnight', 'selected'), song(S3, 'Draft', 'inbox'), song(S2, 'Dawn', 'selected')],
      tasks: [
        { id: t(80), org_id: L, title: 'Secret plan', notes: 'do not leak', due_at: '2026-01-01T00:00:00Z', done_at: null, assignee_id: FIN, created_by: OWN },
        { id: t(81), org_id: L, title: 'Pitch', notes: null, due_at: '2999-01-01T00:00:00Z', done_at: null, assignee_id: AR, created_by: OWN },
        { id: t(82), org_id: L, title: 'Old', notes: null, due_at: null, done_at: '2026-02-01T00:00:00Z', assignee_id: AR, created_by: OWN },
      ],
      activity_events: [],
      user_profiles: [],
    },
    unique: {},
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function get(as: string | null, opts: { org?: string; query?: string } = {}) {
  current = as;
  const org = opts.org ?? L;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/exec${opts.query ?? ''}`), { params: Promise.resolve({ orgId: org }) });
}

const events = () => db.tables.activity_events.filter((e) => e.verb === 'exec.exported');

describe('GET /api/org/[orgId]/exec', () => {
  it('is 401 signed out and 404 for a non-member and another org', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(X)).status).toBeGreaterThanOrEqual(403);
    expect((await get(OWN, { org: L2 })).status).toBeGreaterThanOrEqual(403);
  });

  it('is closed to people without exec.read and to a roster artist', async () => {
    for (const who of [FIN, AR, ART]) expect((await get(who)).status, who).toBeGreaterThanOrEqual(403);
  });

  it('answers a whole-organization executive with every section', async () => {
    const res = await get(EXEC);
    expect(res.status).toBe(200);
    const v = await res.json();
    expect(v.scoped).toBe(false);
    expect(Object.fromEntries(v.pipeline.map((p: { stage: string; count: number }) => [p.stage, p.count]))).toMatchObject({ inbox: 0, selected: 2 });
    // D4: the executive reads finished audio only, so the inbox demo is not theirs to count: it is restricted.
    expect(v.restricted).toBe(1);
    expect(v.months.map((m: { month: string; total: number }) => [m.month, m.total])).toEqual([['2026-04', 1], ['2026-05', 1]]);
    expect(v.blocked.map((b: { title: string }) => b.title)).toEqual(['Nova EP']);
    expect(v.waiting.map((w: { title: string }) => w.title)).toEqual(['Nova EP', '=Kilo Tape']);
    expect(v.money).toEqual([expect.objectContaining({ currency: 'USD', income: '100000' })]);
    expect(v.topSongs.map((s: { title: string }) => s.title)).toEqual(['Dawn', 'Midnight']); // 'Draft' is an inbox demo: D4 keeps it off the executive's list
    expect(v.withheld).toEqual([]);
    expect(v.tasks).toEqual([{ department: 'A&R', open: 1, overdue: 0 }, { department: 'Finance', open: 1, overdue: 1 }]);
  });

  it('never carries a task title, note or person into the answer', async () => {
    const text = await (await get(OWN)).text();
    expect(text).not.toContain('Secret plan');
    expect(text).not.toContain('do not leak');
    expect(text).not.toContain(FIN);
  });

  it('gives a scoped executive only their artists, and withholds money, top songs and task load', async () => {
    const v = await (await get(EXN)).json();
    expect(v.scoped).toBe(true);
    expect(v.blocked.map((b: { title: string }) => b.title)).toEqual(['Nova EP']);
    expect(v.waiting.map((w: { title: string }) => w.title)).toEqual(['Nova EP']);
    expect(Object.fromEntries(v.pipeline.map((p: { stage: string; count: number }) => [p.stage, p.count]))).toMatchObject({ inbox: 0, selected: 1 });
    expect(v.money).toBeNull();
    expect(v.topSongs).toBeNull();
    expect(v.tasks).toBeNull();
    expect(v.withheld).toEqual(['money', 'topSongs', 'tasks']);
    expect(v.restricted).toBe(0);
  });

  it('is 404 when the executive module is not licensed', async () => {
    db.tables.org_entitlements = [{ org_id: L, modules: ['catalog', 'finance'], max_seats: null, max_artists: null }];
    expect((await get(OWN)).status).toBe(404);
  });

  it('rejects an unknown format', async () => {
    expect((await get(EXEC, { query: '?format=xml' })).status).toBe(400);
  });

  describe('CSV', () => {
    it('is audited BEFORE the data and guards formulas', async () => {
      const res = await get(EXEC, { query: '?format=csv' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toMatch(/label-one-executive-\d{4}-\d{2}-\d{2}\.csv/);
      const csv = await res.text();
      expect(csv.split('\r\n')[0]).toBe('"section","name","detail","count","amount_minor","currency"');
      expect(csv).toContain(`"'=Kilo Tape"`);
      expect(csv).not.toMatch(/(^|,)"=Kilo/m);
      expect(events()).toHaveLength(1);
      expect(events()[0]).toMatchObject({ org_id: L, actor_id: EXEC, visibility: 'internal' });
      expect(JSON.stringify(events()[0].payload)).not.toContain('Nova');
    });

    it('does not export when the audit event cannot be written', async () => {
      auditFails = true;
      const res = await get(EXEC, { query: '?format=csv' });
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain('section');
    });

    it('a viewer without exec.read gets no file and no event', async () => {
      expect((await get(FIN, { query: '?format=csv' })).status).toBeGreaterThanOrEqual(403);
      expect(events()).toHaveLength(0);
    });

    it('a scoped export carries nothing outside the scope or the withheld sections', async () => {
      const csv = await (await get(EXN, { query: '?format=csv' })).text();
      expect(csv).not.toContain('Kilo');
      expect(csv).not.toContain('income');
      expect(csv).not.toContain('tasks');
    });
  });
});
