/**
 * GET /api/org/[orgId]/releases/[releaseId]/readiness (LABEL-32), through the
 * REAL lib/auth/org-access, release-readiness(-store), legal-readiness and
 * approvals against an in-memory database.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project, song S1 and
 *     its master M1; release R1 (S1/M1). LP2: Kilo's Inbox, song S2; release R2.
 *     Members: owner and A&R (rights.read), marketing (catalog.read only),
 *     A&R scoped to C2, roster artist C1.
 *   L2: song XS1, release RX. The producer: song PS1 (org_id NULL).
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
const M1 = t(2);
const S2 = t(3);
const XS1 = t(4);
const A1 = '60000000-0000-4000-8000-000000000001';
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const RX = '70000000-0000-4000-8000-000000000003';
const P1 = '90000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
/** Tables PostgREST answers as missing (an unapplied migration). */
let missing = new Set<string>();

/** What the stored artwork file starts with, by its reference (09 §4 size rule reads the file's own header). */
let artworkHead: Record<string, Uint8Array | null> = {};
vi.mock('@/lib/storage/project-assets', () => ({ openProjectAsset: async (ref: string) => artworkHead[ref] ?? null }));
const pngHead = (width: number, height: number, colorType = 2) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b[24] = 8;
  b[25] = colorType;
  return b;
};

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (!missing.has(table)) return mem.client.from(table);
      const res = { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: 'PGRST205' } };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => res;
      q.single = async () => res;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return q;
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
function track(id: string, org: string | null, type: string, title: string) {
  return { id, org_id: org, user_id: org ? null : OWN, type, title, isrc: null };
}
function release(id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) {
  return {
    id, org_id: org, project_id: project, contact_id: contact, title: 'Nova EP', type: 'single', upc: null, label_name: null, c_line: null,
    p_line: null, primary_genre: null, target_date: null, release_date: null, artwork_asset_id: null, state: 'draft', ...extra,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missing = new Set();
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
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: M1, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [track(S1, L, 'song', 'Midnight'), track(M1, L, 'song', 'Midnight (master)'), track(S2, L, 'song', 'Dawn'), track(XS1, L2, 'song', 'Xen')],
      track_links: [{ from_track_id: S1, to_track_id: M1, relation: 'master', user_id: null }],
      project_assets: [{ id: A1, project_id: LP1, org_id: L, kind: 'artwork', mime: 'image/png', sensitivity: 'normal', url: 'local://project-assets/art-1' }],
      parties: [{ id: P1, org_id: L, kind: 'person', display_name: 'Nova', legal_name: null, ipi: null, pro: null, pro_affiliation: 'unknown', publisher_name: null, user_id: null, contact_id: null }],
      track_collaborators: [
        { id: 'c1', org_id: L, track_id: S1, name: 'Nova', role: 'songwriter', source: 'manual', scope: 'composition', status: 'confirmed', party_id: P1, created_at: '2026-10-01' },
      ],
      split_sheets: [],
      split_lines: [],
      approvals: [],
      releases: [
        release(R1, L, LP1, C1, { artwork_asset_id: A1 }),
        release(R2, L, LP2, C2),
        release(RX, L2, XP1, CX),
      ],
      release_items: [
        { id: 'ri1', release_id: R1, org_id: L, position: 1, song_track_id: S1, master_track_id: M1, version_title: null, explicit: false },
        { id: 'ri2', release_id: R2, org_id: L, position: 1, song_track_id: S2, master_track_id: S2, version_title: null, explicit: false },
        { id: 'riX', release_id: RX, org_id: L2, position: 1, song_track_id: XS1, master_track_id: XS1, version_title: null, explicit: false },
      ],
      activity_events: [],
    },
  };
  artworkHead = { 'local://project-assets/art-1': pngHead(3000, 3000) };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function read(as: string | null, org: string, id: string) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/releases/${id}/readiness`);
  return mod.GET(req, { params: Promise.resolve({ orgId: org, releaseId: id }) });
}

describe('the derived gates', () => {
  it('a half-finished release is blocked where it should be and not ready', async () => {
    const res = await read(OWN, L, R1);
    expect(res.status).toBe(200);
    const { schemaReady, readiness } = await res.json();
    expect(schemaReady).toBe(true);
    expect(readiness.readyToDeliver).toBe(false);
    expect(readiness.gates.tracklist.status).toBe('satisfied');
    expect(readiness.gates.masters.status).toBe('not_started');
    expect(readiness.gates.credits_splits.status).toBe('blocked');
    expect(readiness.gates.legal.status).toBe('blocked');
    expect(readiness.gates.artwork.status).toBe('not_started');
    expect(readiness.gates.metadata.status).toBe('blocked');
  });

  it('reads the org switches and a stale approval', async () => {
    db.tables.organizations[0].settings = { legal_gate: 'off', marketing_gate: 'off', digest: { x: 1 } };
    db.tables.approvals.push({
      id: 'ap1', org_id: L, song_id: null, release_id: R1, gate: 'master', decision: 'approved', note: null, actor_id: OWN,
      approver_id: null, request_id: null, created_at: '2026-10-02T00:00:00Z',
      subject_snapshot: { v: 1, gate: 'master', parts: { items: [{ songId: S1, masterId: S1 }] } },
    });
    const { readiness } = await (await read(OWN, L, R1)).json();
    expect(readiness.gates.legal.status).toBe('not_required');
    expect(readiness.gates.marketing.status).toBe('not_required');
    expect(readiness.gates.masters.status).toBe('stale');
    expect(readiness.gates.masters.approval).toMatchObject({ status: 'approved', stale: true });
  });

  it('artwork size rule (09 §4), read from the stored file: square, RGB, at least the org minimum', async () => {
    const blockers = async () => (await (await read(OWN, L, R1)).json()).readiness.gates.artwork.blockers.map((b: { code: string }) => b.code);
    expect(await blockers()).toEqual([]);
    artworkHead['local://project-assets/art-1'] = pngHead(2999, 2999);
    expect(await blockers()).toEqual(['artwork_too_small']);
    artworkHead['local://project-assets/art-1'] = pngHead(3600, 3000);
    expect(await blockers()).toEqual(['artwork_not_square']);
    artworkHead['local://project-assets/art-1'] = pngHead(3000, 3000, 0);
    expect(await blockers()).toEqual(['artwork_color']);
    // The org's own minimum.
    db.tables.organizations[0].settings = { artwork_min_px: 2000 };
    artworkHead['local://project-assets/art-1'] = pngHead(2400, 2400);
    expect(await blockers()).toEqual([]);
    // A file that is gone or is not an image cannot vouch for itself.
    artworkHead['local://project-assets/art-1'] = null;
    expect(await blockers()).toEqual(['artwork_unreadable']);
    artworkHead['local://project-assets/art-1'] = new TextEncoder().encode('not an image at all, just words');
    expect(await blockers()).toEqual(['artwork_unreadable']);
  });

  it('an approved artwork whose snapshot matches stays approved', async () => {
    db.tables.approvals.push({
      id: 'ap2', org_id: L, song_id: null, release_id: R1, gate: 'artwork', decision: 'approved', note: 'ok', actor_id: OWN,
      approver_id: null, request_id: null, created_at: '2026-10-02T00:00:00Z',
      subject_snapshot: { v: 1, gate: 'artwork', parts: { artwork: A1 } },
    });
    const { readiness } = await (await read(OWN, L, R1)).json();
    expect(readiness.gates.artwork.status).toBe('approved');
  });
});

describe('redaction by capability', () => {
  it('rights.read lists the named gaps; marketing gets counts', async () => {
    for (const who of [OWN, AR]) {
      const { readiness } = await (await read(who, L, R1)).json();
      expect(readiness.gates.credits_splits.blockers.length).toBeGreaterThan(0);
      expect(JSON.stringify(readiness.gates.credits_splits)).toContain('Nova');
    }
    const full = (await (await read(OWN, L, R1)).json()).readiness;
    const { readiness } = await (await read(MKT, L, R1)).json();
    const g = readiness.gates.credits_splits;
    expect(g.status).toBe('blocked');
    expect(g.blockers).toEqual([]);
    expect(g.blockerCount).toBe(full.gates.credits_splits.blockerCount);
    expect(g.withheld).toBeGreaterThan(0);
    expect(JSON.stringify(readiness)).not.toContain('Nova');
    // Non-rights blockers (tracklist, metadata) are still listed.
    expect(readiness.gates.metadata.blockers.length).toBeGreaterThan(0);
  });
});

describe('scope and shape: 404 for what the caller may not know about', () => {
  it('a release outside the member’s artist scope', async () => {
    expect((await read(AR_C2, L, R1)).status).toBe(404);
    expect((await read(AR_C2, L, R2)).status).toBe(200);
  });
  it('another org’s release, a missing id, a stranger, an id that is not a release', async () => {
    expect((await read(OWN, L, RX)).status).toBe(404);
    expect((await read(X, L, R1)).status).toBe(404);
    expect((await read(OWN, L, '70000000-0000-4000-8000-000000000099')).status).toBe(404);
    expect((await read(OWN, L, 'not-a-uuid')).status).toBe(404);
    expect((await read(u(9), L, R1)).status).toBe(404);
  });
  it('signed out', async () => {
    expect((await read(null, L, R1)).status).toBe(401);
  });
});

describe('cancelled release', () => {
  it('requires nothing', async () => {
    db.tables.releases[0].state = 'cancelled';
    const { readiness } = await (await read(OWN, L, R1)).json();
    expect(readiness.readyToDeliver).toBe(false);
    expect(Object.values(readiness.gates).every((g) => (g as { status: string }).status === 'not_required')).toBe(true);
  });
});

describe('migrations not applied', () => {
  for (const [table, migration] of [['releases', '144'], ['approvals', '157'], ['split_sheets', '155'], ['track_collaborators', '153']] as const) {
    it(`${migration} (${table}) missing answers schemaReady: false, not a 500`, async () => {
      missing.add(table);
      const res = await read(OWN, L, R1);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ schemaReady: false });
    });
  }
});
