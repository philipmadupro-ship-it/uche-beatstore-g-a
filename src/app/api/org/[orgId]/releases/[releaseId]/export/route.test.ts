/**
 * GET /api/org/[orgId]/releases/[releaseId]/export (LABEL-34), through the
 * REAL lib/auth/org-access, metadata-export(-store) and activity writer
 * against an in-memory database.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project, song S1,
 *     master M1; release R1 (S1/M1). LP2: Kilo's Inbox; release R2.
 *     Members: owner and A&R (release.write + rights.read), A&R with
 *     rights.read revoked, marketing (no release.write), A&R scoped to C2,
 *     roster artist C1. L2: release RX. The producer: a release-less id.
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
const ARTIST = u(6);
const X = u(7);
const AR_NORIGHTS = u(8);
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
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const RX = '70000000-0000-4000-8000-000000000003';
const P1 = '90000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let limited = false;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => !limited, clientIp: () => '127.0.0.1', rateLimit: () => true }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L, extra: Record<string, unknown> = {}) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [], ...extra };
}
function track(id: string, org: string, title: string, isrc: string | null) {
  return { id, org_id: org, user_id: null, type: 'song', title, isrc };
}
function release(id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) {
  return {
    id, org_id: org, project_id: project, contact_id: contact, title: 'Nova EP', type: 'ep', upc: '012345678905', label_name: 'Night Shift',
    c_line: '© 2026 Night Shift', p_line: '℗ 2026 Night Shift', primary_genre: 'Alt R&B', target_date: '2026-11-01', release_date: '2026-11-06',
    artwork_asset_id: null, state: 'draft', ...extra,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  limited = false;
  db = {
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null, settings: {} },
        { id: L2, kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(AR_NORIGHTS, 'member', ['a_and_r'], 'org', L, { cap_revokes: ['rights.read'] }),
        member(MKT, 'member', ['marketing']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(ARTIST, 'artist', [], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [
        { org_id: L, user_id: AR_C2, contact_id: C2 },
        { org_id: L, user_id: ARTIST, contact_id: C1 },
      ],
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
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: M1, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [track(S1, L, 'Midnight', null), track(M1, L, 'Midnight (master)', 'USABC2600001'), track(S2, L, 'Dawn', 'USABC2600009'), track(XS1, L2, 'Xen', null)],
      parties: [{ id: P1, org_id: L, kind: 'person', display_name: 'Nova', legal_name: 'Nova Okafor', email: 'nova@example.com', ipi: '00987654321', isni: '0000000123456789', pro: 'ASCAP', user_id: null, contact_id: C1 }],
      track_collaborators: [
        { id: 'c1', org_id: L, track_id: S1, name: 'Nova', role: 'songwriter', source: 'manual', scope: 'composition', status: 'confirmed', party_id: P1, created_at: '2026-10-01' },
        { id: 'c2', org_id: L, track_id: M1, name: 'Kilo', role: 'mixer', source: 'manual', scope: 'recording', status: 'confirmed', party_id: null, created_at: '2026-10-02' },
        { id: 'c3', org_id: L, track_id: M1, name: 'Hopeful Hank', role: 'producer', source: 'manual', scope: 'recording', status: 'proposed', party_id: null, created_at: '2026-10-03' },
      ],
      releases: [release(R1, L, LP1, C1), release(R2, L, LP2, C2, { title: 'Kilo LP' }), release(RX, L2, XP1, CX, { title: 'Xen' })],
      release_items: [
        { id: 'ri1', release_id: R1, org_id: L, position: 1, song_track_id: S1, master_track_id: M1, version_title: 'Radio Edit', explicit: true },
        { id: 'ri2', release_id: R2, org_id: L, position: 1, song_track_id: S2, master_track_id: S2, version_title: null, explicit: false },
        { id: 'riX', release_id: RX, org_id: L2, position: 1, song_track_id: XS1, master_track_id: XS1, version_title: null, explicit: false },
      ],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function exportAs(as: string | null, org: string, id: string, query = '?format=csv') {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/releases/${id}/export${query}`);
  return mod.GET(req, { params: Promise.resolve({ orgId: org, releaseId: id }) });
}

const events = () => db.tables.activity_events;

describe('the export', () => {
  it('returns the CSV with ERN-aligned columns, the master’s ISRC and the confirmed credits (rights.read)', async () => {
    const res = await exportAs(AR, L, R1);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="nova-ep-metadata.csv"');
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const csv = await res.text();
    const [head, row] = csv.trimEnd().split('\r\n');
    expect(head).toBe('"ReleaseTitle","ReleaseType","DisplayArtistName","LabelName","UPC","PLine","CLine","GenreText","ReleaseDate","SequenceNumber","ISRC","TrackTitle","SubTitle","ParentalWarningType","Contributors","ContributorIPI"');
    expect(row).toBe('"Nova EP","ep","Nova","Night Shift","012345678905","℗ 2026 Night Shift","© 2026 Night Shift","Alt R&B","2026-11-06","1","USABC2600001","Midnight","Radio Edit","Explicit","Nova (Songwriter) | Kilo (Mixer)","00987654321 | "');
    expect(csv).not.toMatch(/Hopeful Hank|Okafor|nova@example|0000000123456789|ASCAP/);
  });

  it('returns JSON on request', async () => {
    const res = await exportAs(OWN, L, R1, '?format=json');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.schema).toBe('label-os.release-metadata/1');
    expect(body.release.UPC).toBe('012345678905');
    expect(body.tracks[0].Contributors).toHaveLength(2);
    expect(body.warnings).toEqual(['1 credit is proposed or disputed and not included.']);
  });

  it('defaults to CSV and rejects an unknown format', async () => {
    expect((await exportAs(OWN, L, R1, '')).headers.get('content-type')).toMatch(/csv/);
    const before = events().length;
    const bad = await exportAs(OWN, L, R1, '?format=xml');
    expect(bad.status).toBe(400);
    expect(events()).toHaveLength(before);
  });

  it('release.write WITHOUT rights.read gets the release and tracks but no credits, and is told', async () => {
    const csv = await (await exportAs(AR_NORIGHTS, L, R1)).text();
    expect(csv.split('\r\n')[0]).not.toMatch(/Contributor/);
    expect(csv).toContain('USABC2600001');
    expect(csv).not.toMatch(/Kilo|Nova \(|00987654321/);
    const json = await (await exportAs(AR_NORIGHTS, L, R1, '?format=json')).json();
    expect(json.withheld).toEqual(['contributors']);
    expect(json.tracks[0]).not.toHaveProperty('Contributors');
  });

  it('before migration 153 it exports without credits and says why', async () => {
    db.tables.track_collaborators = undefined as never;
    const real = mem.client.from;
    mem.client.from = ((table: string) => {
      if (table !== 'track_collaborators') return real(table);
      const res = { data: null, error: { message: 'missing', code: 'PGRST205' } };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return q;
    }) as typeof mem.client.from;
    const json = await (await exportAs(OWN, L, R1, '?format=json')).json();
    expect(json.warnings.join(' ')).toMatch(/migration 153/);
    expect(json.tracks[0]).not.toHaveProperty('Contributors');
  });
});

describe('who may export', () => {
  it('needs release.write: marketing (catalog.read only) is 403, nothing written', async () => {
    expect((await exportAs(MKT, L, R1)).status).toBe(403);
    expect(events()).toEqual([]);
  });

  it('a roster artist (no release.write) is 403', async () => {
    expect((await exportAs(ARTIST, L, R1)).status).toBe(403);
  });

  it('artist scope is 404 outside: A&R scoped to Kilo cannot export Nova’s release, can export Kilo’s', async () => {
    expect((await exportAs(AR_C2, L, R1)).status).toBe(404);
    expect((await exportAs(AR_C2, L, R2)).status).toBe(200);
  });

  it('another org’s release, a missing id and a malformed id are 404; signed out is 401', async () => {
    expect((await exportAs(OWN, L, RX)).status).toBe(404);
    expect((await exportAs(X, L2, R1)).status).toBe(404);
    expect((await exportAs(OWN, L, '70000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await exportAs(OWN, L, 'nope')).status).toBe(404);
    expect((await exportAs(null, L, R1)).status).toBe(401);
    expect(events()).toEqual([]);
  });

  it('is rate-limited', async () => {
    limited = true;
    expect((await exportAs(OWN, L, R1)).status).toBe(429);
    expect(events()).toEqual([]);
  });
});

describe('audit', () => {
  it('records release.metadata_exported (audit class, internal) with counts and no content', async () => {
    await exportAs(AR, L, R1, '?format=json');
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      org_id: L,
      actor_id: AR,
      verb: 'release.metadata_exported',
      subject_type: 'release',
      subject_id: R1,
      release_id: R1,
      project_id: LP1,
      audit: true,
      visibility: 'internal',
      payload: { format: 'json', tracks: 1, contributors: true },
    });
    expect(JSON.stringify(events()[0].payload)).not.toMatch(/Nova|USABC/);
  });

  it('no audit event, no data: a failed event write returns 500 and no body', async () => {
    const real = mem.client.from;
    mem.client.from = ((table: string) => {
      if (table !== 'activity_events') return real(table);
      const fail = { data: null, error: { message: 'boom' } };
      const q: Record<string, unknown> = {};
      for (const m of ['insert', 'select']) q[m] = () => q;
      q.single = async () => fail;
      return q;
    }) as typeof mem.client.from;
    const res = await exportAs(OWN, L, R1);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/USABC|Nova EP/);
  });
});
