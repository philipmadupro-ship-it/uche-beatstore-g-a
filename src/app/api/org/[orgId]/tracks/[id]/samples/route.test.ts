/**
 * /api/org/[orgId]/tracks/[id]/samples (LABEL-29), through the
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
const A1 = '90000000-0000-4000-8000-000000000001';
const A2 = '90000000-0000-4000-8000-000000000002';
const A3 = '90000000-0000-4000-8000-000000000003';
const A4 = '90000000-0000-4000-8000-000000000004';

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
      // On a release, so marketing (finished material only, D4) may read the row.
      releases: [{ id: REL, org_id: L, state: 'draft' }],
      release_items: [{ id: 'ri1', org_id: L, release_id: REL, song_track_id: S1, master_track_id: S1 }],
      project_assets: [
        { id: A1, org_id: L, project_id: LP1, sensitivity: 'restricted' },
        { id: A2, org_id: L, project_id: LP1, sensitivity: 'normal' },
        { id: A3, org_id: L, project_id: LP2, sensitivity: 'restricted' },
        { id: A4, org_id: L2, project_id: XP1, sensitivity: 'restricted' },
      ],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(method: 'GET' | 'PUT', as: string | null, org: string, id: string, body?: unknown) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/tracks/${id}/samples`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return mod[method](req, { params: Promise.resolve({ orgId: org, id }) });
}
const row = (id: string) => db.tables.tracks.find((r) => r.id === id)!;
const events = () => db.tables.activity_events;

describe('PUT: declare', () => {
  it('records a declaration, with the event and no note in it', async () => {
    const res = await call('PUT', AR, L, S1, { samples: 'yes', note: 'Cleared with Sony, see folder' });
    expect(res.status).toBe(200);
    const { samples } = await res.json();
    expect(samples).toMatchObject({ value: 'yes', cleared: true, hasFile: false, note: 'Cleared with Sony, see folder', canWrite: true });
    expect(row(S1)).toMatchObject({ samples_declared: 'yes', samples_clearance_note: 'Cleared with Sony, see folder', samples_clearance_asset_id: null });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ verb: 'song.samples_declared', visibility: 'internal', payload: { samples: 'yes', cleared: true } });
    expect(JSON.stringify(events()[0])).not.toContain('Sony');
  });

  it('declaring none drops the note and the file; an unchanged write records nothing', async () => {
    row(S1).samples_declared = 'yes';
    row(S1).samples_clearance_note = 'x';
    row(S1).samples_clearance_asset_id = A1;
    expect((await call('PUT', OWN, L, S1, { samples: 'none' })).status).toBe(200);
    expect(row(S1)).toMatchObject({ samples_declared: 'none', samples_clearance_note: null, samples_clearance_asset_id: null });
    expect(events()).toHaveLength(1);
    expect((await call('PUT', OWN, L, S1, { samples: 'none' })).status).toBe(200);
    expect(events()).toHaveLength(1);
  });

  it('attaches a restricted file of a project that holds the song, and never sends its id back', async () => {
    const res = await call('PUT', OWN, L, S1, { samples: 'yes', asset_id: A1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.samples).toMatchObject({ cleared: true, hasFile: true });
    expect(JSON.stringify(body)).not.toContain(A1);
    expect(row(S1).samples_clearance_asset_id).toBe(A1);
  });

  it('refuses a normal file, a file of another project, another org’s file and a missing one', async () => {
    expect((await call('PUT', OWN, L, S1, { samples: 'yes', asset_id: A2 })).status).toBe(400);
    expect((await call('PUT', OWN, L, S1, { samples: 'yes', asset_id: A3 })).status).toBe(400);
    expect((await call('PUT', OWN, L, S1, { samples: 'yes', asset_id: A4 })).status).toBe(404);
    expect((await call('PUT', OWN, L, S1, { samples: 'yes', asset_id: '90000000-0000-4000-8000-0000000000ff' })).status).toBe(404);
    expect(row(S1).samples_declared).toBeUndefined();
    expect(events()).toHaveLength(0);
  });

  it('is strict about the body', async () => {
    expect((await call('PUT', OWN, L, S1, { samples: 'maybe' })).status).toBe(400);
    expect((await call('PUT', OWN, L, S1, { samples: 'yes', extra: 1 })).status).toBe(400);
    expect((await call('PUT', OWN, L, S1, { samples: 'yes', note: 'x'.repeat(2001) })).status).toBe(400);
  });
});

describe('who may', () => {
  it('marketing (catalog.read) reads the declaration but cannot write it, and sees no note', async () => {
    row(S1).samples_declared = 'yes';
    row(S1).samples_clearance_note = 'private words';
    const get = await call('GET', MKT, L, S1);
    expect(get.status).toBe(200);
    const { samples } = await get.json();
    expect(samples).toMatchObject({ value: 'yes', cleared: true, canWrite: false });
    expect('note' in samples).toBe(false);
    expect(JSON.stringify(samples)).not.toContain('private words');
    expect((await call('PUT', MKT, L, S1, { samples: 'none' })).status).toBe(403);
    expect(row(S1).samples_declared).toBe('yes');
  });

  it('the producer function (catalog.write) writes and reads the note', async () => {
    const res = await call('PUT', PRODUCER_FN, L, S1, { samples: 'yes', note: 'mine' });
    expect(res.status).toBe(200);
    expect((await res.json()).samples.note).toBe('mine');
  });

  it('404, never 403, for what the caller may not know about', async () => {
    expect((await call('PUT', AR_C2, L, S1, { samples: 'none' })).status).toBe(404);
    expect((await call('GET', AR_C2, L, S2)).status).toBe(200);
    for (const id of [XS1, PS1, B1, t(99)]) {
      expect((await call('GET', OWN, L, id)).status, id).toBe(404);
      expect((await call('PUT', OWN, L, id, { samples: 'none' })).status, id).toBe(404);
    }
    expect((await call('PUT', X, L, S1, { samples: 'none' })).status).toBe(404);
    expect((await call('PUT', null, L, S1, { samples: 'none' })).status).toBe(401);
    expect(events()).toHaveLength(0);
  });
});

describe('GET', () => {
  it('a song nothing was declared on reads unknown', async () => {
    const { samples } = await (await call('GET', OWN, L, S1)).json();
    expect(samples).toMatchObject({ value: 'unknown', cleared: false, hasFile: false });
  });
});
