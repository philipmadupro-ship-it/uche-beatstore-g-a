/**
 * GET /api/org/[orgId]/tracks/[id]/legal-readiness (LABEL-29), through the
 * REAL lib/auth/org-access, credits / splits stores and legal-readiness
 * against an in-memory database.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project with song S1
 *     (credits, a signed composition split, a master split, on a release),
 *     a beat B1. LP2: Kilo's Inbox with song S2. S3: a song in no project.
 *     Members: owner and A&R (rights.read), marketing (catalog.read only),
 *     producer function (own line only), A&R scoped to C2.
 *   L2: song XS1. The producer: song PS1 (org_id NULL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const MKT = u(3);
const PRODUCER_FN = u(4);
const AR_C2 = u(5);
const X = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const B1 = t(2);
const S2 = t(4);
const S3 = t(5);
const XS1 = t(6);
const PS1 = t(7);
const P1 = '60000000-0000-4000-8000-000000000001';
const SHEET = '70000000-0000-4000-8000-000000000001';
const REL = '80000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mem.client,
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
function track(id: string, org: string | null, type: string, title: string) {
  return { id, org_id: org, user_id: org ? null : OWN, type, title, isrc: null };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null, settings: {} },
        { id: L2, kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(PRODUCER_FN, 'member', ['producer']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: B1, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Midnight'),
        track(B1, L, 'beat', 'Beat'),
        track(S2, L, 'song', 'Dawn'),
        track(S3, L, 'song', 'Loose'),
        track(XS1, L2, 'song', 'Xen single'),
        track(PS1, null, 'song', 'Producer song'),
      ],
      track_links: [],
      song_beats: [],
      parties: [
        { id: P1, org_id: L, kind: 'person', display_name: 'Nova', legal_name: null, ipi: null, pro: null, pro_affiliation: 'unknown', publisher_name: null, user_id: null, contact_id: null },
      ],
      track_collaborators: [
        { id: 'c1', org_id: L, track_id: S1, name: 'Nova', role: 'songwriter', source: 'manual', scope: 'composition', status: 'confirmed', party_id: P1, created_at: '2026-10-01' },
      ],
      split_sheets: [
        { id: SHEET, org_id: L, track_id: S1, kind: 'composition', version: 1, status: 'circulated', created_at: '2026-10-01' },
      ],
      split_lines: [
        { id: 'l1', org_id: L, split_sheet_id: SHEET, party_id: P1, role: 'writer', share: '100.0000', signed_at: null, created_at: '2026-10-01' },
      ],
      releases: [{ id: REL, org_id: L, state: 'draft' }],
      release_items: [{ id: 'ri1', org_id: L, release_id: REL, song_track_id: S1, master_track_id: S1 }],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function read(as: string | null, org: string, id: string) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/tracks/${id}/legal-readiness`);
  return mod.GET(req, { params: Promise.resolve({ orgId: org, id }) });
}

describe('rights.read sees the named gaps', () => {
  it('lists requirements and reasons for the owner and for A&R', async () => {
    for (const who of [OWN, AR]) {
      const res = await read(who, L, S1);
      expect(res.status).toBe(200);
      const { readiness, schemaReady } = await res.json();
      expect(schemaReady).toBe(true);
      expect(readiness.detail).toBe('full');
      expect(readiness.ready).toBe(false);
      const l3 = readiness.requirements.find((q: { code: string }) => q.code === 'L3');
      expect(l3.reasons[0].message).toBe('Nova has no legal name.');
      const l7 = readiness.requirements.find((q: { code: string }) => q.code === 'L7');
      expect(l7.reasons[0].message).toContain('0 of 1');
      // The song is on a (draft) release, so the master split is a blocker.
      expect(readiness.requirements.find((q: { code: string }) => q.code === 'L10').applicable).toBe(true);
    }
  });

  it('reads an unknown samples declaration as a blocker when no column exists', async () => {
    const { readiness } = await (await read(OWN, L, S1)).json();
    expect(readiness.requirements.find((q: { code: string }) => q.code === 'L8').satisfied).toBe(false);
  });

  it('reads a declared column and a cancelled release', async () => {
    db.tables.tracks.find((r) => r.id === S1)!.samples_declared = 'none';
    db.tables.releases[0].state = 'cancelled';
    const { readiness } = await (await read(OWN, L, S1)).json();
    expect(readiness.requirements.find((q: { code: string }) => q.code === 'L8').satisfied).toBe(true);
    expect(readiness.requirements.find((q: { code: string }) => q.code === 'L10').applicable).toBe(false);
  });
});

describe('without rights.read: counts only', () => {
  it('marketing (catalog.read) gets the counts and the percentage, no names, no reasons', async () => {
    const full = (await (await read(OWN, L, S1)).json()).readiness;
    for (const who of [MKT, PRODUCER_FN]) {
      const res = await read(who, L, S1);
      expect(res.status).toBe(200);
      const { readiness } = await res.json();
      expect(readiness).toEqual({ detail: 'counts', ready: false, percent: full.percent, blockerCount: full.blockerCount, warningCount: full.warningCount });
      expect(JSON.stringify(readiness)).not.toContain('Nova');
    }
  });
});

describe('scope and shape: 404, never 403, for what the caller may not know about', () => {
  it('a song outside the member’s artist scope', async () => {
    expect((await read(AR_C2, L, S1)).status).toBe(404);
    expect((await read(AR_C2, L, S2)).status).toBe(200);
  });
  it('another org’s song, a producer track, a missing id', async () => {
    expect((await read(OWN, L, XS1)).status).toBe(404);
    expect((await read(OWN, L, PS1)).status).toBe(404);
    expect((await read(OWN, L, t(99))).status).toBe(404);
    expect((await read(X, L, S1)).status).toBe(404);
  });
  it('a track that is not a song', async () => {
    expect((await read(OWN, L, B1)).status).toBe(404);
  });
  it('a stranger and a signed-out caller', async () => {
    expect((await read(u(9), L, S1)).status).toBe(404);
    expect((await read(null, L, S1)).status).toBe(401);
  });
});

describe('migrations not applied', () => {
  it('answers schemaReady: false instead of a 500', async () => {
    // memory-db answers an unknown table with no rows; ask for the table error the way PostgREST does.
    const orig = mem.client.from;
    mem.client.from = ((tbl: string) => {
      if (tbl !== 'split_sheets') return orig(tbl);
      const err = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.split_sheets' in the schema cache" } };
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'in', 'order']) b[k] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(err).then(resolve);
      return b;
    }) as typeof mem.client.from;
    const res = await read(OWN, L, S1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaReady: false });
  });
});
