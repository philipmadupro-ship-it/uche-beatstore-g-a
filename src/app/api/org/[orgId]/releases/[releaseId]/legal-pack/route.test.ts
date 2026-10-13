/**
 * GET /api/org/[orgId]/releases/[releaseId]/legal-pack (LABEL-31), through
 * the REAL lib/auth/org-access, legal-pack(-store), activity and the zip
 * writer, against an in-memory database that evaluates filters. Only storage
 * is faked.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1 Nova's project with song S1 and
 *     release R1 (items S1, S2). LP2 Kilo's Inbox with S2.
 *     Members: OWN (owner), LG (legal), LGN (legal, scoped to Nova), AR (A&R: no
 *     contracts.read), PRD (producer), EDITOR (external editor of LP1).
 *   L2: owner X, release XR1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unzipSync, strFromU8 } from 'fflate';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const LG = u(2);
const LGN = u(3);
const AR = u(4);
const PRD = u(5);
const EDITOR = u(11);
const X = u(16);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const XS1 = t(3);
const R1 = '60000000-0000-4000-8000-000000000001';
const XR1 = '60000000-0000-4000-8000-000000000002';
const PN = '70000000-0000-4000-8000-0000000000a1';
const PF = '70000000-0000-4000-8000-0000000000a2';
const PK = '70000000-0000-4000-8000-0000000000a3';
const SHEET = '80000000-0000-4000-8000-000000000001';
const A_DOC = 'a0000000-0000-4000-8000-0000000000d1'; // the sheet's own document: fine
const A_SIG = 'a0000000-0000-4000-8000-0000000000d2'; // a signature whose reference is not this org's key
const A_CLR = 'a0000000-0000-4000-8000-0000000000d3'; // a clearance missing from storage

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
vi.mock('@/lib/storage/project-assets', () => ({
  projectAssetBuckets: () => ['priv'],
  projectAssetSize: async (ref: string) => (ref.includes('gone') ? null : 8),
  openProjectAsset: async (ref: string) => new TextEncoder().encode(`PDF:${ref}`),
}));
// An audit verb that cannot be written must stop the export: simulate the write failing.
vi.mock('@/lib/labelos/activity', async (orig) => {
  const real = await orig<typeof import('@/lib/labelos/activity')>();
  return {
    ...real,
    recordEvent: (...args: Parameters<typeof real.recordEvent>) => {
      if (auditFails && args[2] === 'release.legal_pack_exported') throw new real.AuditEventError(args[2], 'insert failed');
      return real.recordEvent(...args);
    },
  };
});

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const song = (id: string, org: string, title: string) => ({ id, org_id: org, user_id: null, type: 'song', title, song_stage: 'selected' });
const party = (id: string, name: string, legal: string | null, extra: Record<string, unknown> = {}) => ({
  id, org_id: L, kind: 'person', display_name: name, legal_name: legal, email: null, ipi: '00123456789', isni: null, pro: 'ASCAP', pro_affiliation: 'affiliated', publisher_name: 'Pub Co', publisher_ipi: null, contact_id: null, user_id: null, created_at: '2026-10-01', ...extra,
});
const line = (id: string, party_id: string, share: string, position: number, extra: Record<string, unknown> = {}) => ({ id, split_sheet_id: SHEET, org_id: L, party_id, role: 'writer', share, position, signed_at: null, signature_method: null, signature_asset_id: null, ...extra });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  auditFails = false;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(LG, 'member', ['legal']),
        member(LGN, 'member', ['legal'], 'artists'),
        member(AR, 'member', ['a_and_r']),
        member(PRD, 'member', ['producer']),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: LGN, contact_id: C1 }],
      project_members: [{ org_id: L, project_id: LP1, user_id: EDITOR, role: 'editor', allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP2, track_id: S2, position: 0 },
      ],
      tracks: [{ ...song(S1, L, 'Midnight'), samples_declared: 'yes', samples_clearance_asset_id: A_CLR }, song(S2, L, 'Dawn'), song(XS1, L2, 'Other')],
      releases: [
        { id: R1, org_id: L, project_id: LP1, contact_id: C1, title: 'Nova EP', type: 'ep', state: 'draft' },
        { id: XR1, org_id: L2, project_id: XP1, contact_id: null, title: 'Other EP', type: 'ep', state: 'draft' },
      ],
      release_items: [
        { id: t(90), release_id: R1, org_id: L, position: 1, song_track_id: S1, master_track_id: S1 },
        { id: t(91), release_id: R1, org_id: L, position: 2, song_track_id: S2, master_track_id: S2 },
      ],
      parties: [party(PN, 'Nova', 'Nova Okafor'), party(PF, 'Eve', '=HYPERLINK("http://evil","x")'), party(PK, 'Kilo', null, { pro: null, ipi: null, publisher_name: null })],
      split_sheets: [
        { id: SHEET, org_id: L, track_id: S1, kind: 'composition', version: 1, status: 'signed', note: null, document_asset_id: A_DOC, created_by: OWN, created_at: '2026-10-01', circulated_at: '2026-10-01', signed_at: '2026-10-02', superseded_at: null, superseded_by: null },
      ],
      split_lines: [
        line(t(70), PN, '60.0000', 0, { signed_at: '2026-10-02T10:00:00Z', signature_method: 'upload', signature_asset_id: A_SIG }),
        line(t(71), PF, '40.0000', 1),
      ],
      track_collaborators: [
        { id: t(60), track_id: S1, org_id: L, name: 'Kilo', role: 'mixing_engineer', status: 'confirmed', party_id: PK, scope: 'recording', created_by: OWN, created_at: '2026-10-01' },
      ],
      project_assets: [
        { id: A_DOC, org_id: L, project_id: LP1, kind: 'split_sheet', sensitivity: 'restricted', label: 'Split', file_name: 'split.pdf', url: `r2://priv/orgs/${L}/assets/${LP1}/aaaa1111.pdf`, mime: 'application/pdf' },
        { id: A_SIG, org_id: L, project_id: LP1, kind: 'split_sheet', sensitivity: 'restricted', label: 'Sig', file_name: 'sig.pdf', url: 'r2://priv/data/somebody-elses.pdf', mime: 'application/pdf' },
        { id: A_CLR, org_id: L, project_id: LP1, kind: 'document', sensitivity: 'normal', label: 'Clearance', file_name: 'clr.pdf', url: `r2://priv/orgs/${L}/assets/${LP1}/gone1111.pdf`, mime: 'application/pdf' },
      ],
      activity_events: [],
      user_profiles: [],
    },
    unique: {},
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function get(as: string | null, release = R1, opts: { org?: string; query?: string } = {}) {
  current = as;
  const org = opts.org ?? L;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/releases/${release}/legal-pack${opts.query ?? ''}`), { params: Promise.resolve({ orgId: org, releaseId: release }) });
}

const events = () => db.tables.activity_events.filter((e) => e.verb === 'release.legal_pack_exported');
const unzip = async (res: Response) => {
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
};

describe('who may export', () => {
  it('is denied without contracts.read (403) and nothing is audited or returned', async () => {
    for (const who of [AR, PRD]) {
      const res = await get(who);
      expect(res.status, who).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/json/);
    }
    expect(events()).toEqual([]);
  });

  it('answers 401 signed out', async () => {
    expect((await get(null)).status).toBe(401);
    expect(events()).toEqual([]);
  });

  it('is 404 for another org’s release, whoever asks, and for the same release through the wrong org', async () => {
    expect((await get(OWN, XR1)).status).toBe(404);
    expect((await get(X, R1, { org: L2 })).status).toBe(404);
    expect((await get(X, R1)).status).toBe(404); // not a member of L: the same answer as a missing one
    expect(events()).toEqual([]);
  });

  it('is 404 outside the member’s artist scope', async () => {
    const res = await get(LGN, R1);
    expect(res.status).toBe(200); // Nova is in scope
    db.tables.member_artist_scopes = [{ org_id: L, user_id: LGN, contact_id: C2 }];
    const out = await get(LGN, R1);
    expect(out.status).toBe(404);
    expect(events()).toHaveLength(1);
  });

  it('an external project member reaches nothing', async () => {
    const res = await get(EDITOR);
    expect([403, 404]).toContain(res.status);
    expect(events()).toEqual([]);
  });

  it('a malformed id is 404, a bad format 400', async () => {
    expect((await get(LG, 'not-a-uuid')).status).toBe(404);
    expect((await get(LG, R1, { query: '?format=pdf' })).status).toBe(400);
  });
});

describe('the pack', () => {
  it('is a zip of README, legal-pack.csv (09 §3.3 columns) and the documents that exist', async () => {
    const res = await get(LG);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/Nova-EP-legal-pack-\d{8}\.zip/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const files = await unzip(res);
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'documents/Midnight/Composition split v1 (document)-a0000000.pdf', 'legal-pack.csv']);
    expect(files['documents/Midnight/Composition split v1 (document)-a0000000.pdf']).toBe(`PDF:r2://priv/orgs/${L}/assets/${LP1}/aaaa1111.pdf`);
    const [header, ...rows] = files['legal-pack.csv'].trimEnd().split('\r\n');
    expect(header).toBe('Song,Role,Legal name,PRO,IPI,Publisher,Share,Signed at');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe('Midnight,Writer,Nova Okafor,ASCAP,00123456789,Pub Co,60%,2026-10-02T10:00:00Z');
    // Kilo has a credit and no split line: listed, with the gap spelled out.
    expect(rows[2]).toBe('Midnight,Mixing engineer,(missing: Kilo),,,,,');
    // A signature whose file is not this org's key, and a clearance gone from storage, are named, not shipped.
    expect(files['README.txt']).toContain('Composition split v1 signature — Midnight');
    expect(files['README.txt']).toContain('Sample clearance — Midnight');
    expect(files['README.txt']).not.toContain('somebody-elses');
  });

  it('defuses a formula in a legal name', async () => {
    const csv = await get(LG, R1, { query: '?format=csv' }).then((r) => r.text());
    const row = csv.split('\r\n').find((l) => l.includes('HYPERLINK'))!;
    expect(row).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(row.startsWith('Midnight,Writer,')).toBe(true);
  });

  it('?format=csv is the CSV alone, and is audited too', async () => {
    const res = await get(OWN, R1, { query: '?format=csv' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect((await res.text()).split('\r\n')[0]).toBe('Song,Role,Legal name,PRO,IPI,Publisher,Share,Signed at');
    expect(events()).toHaveLength(1);
    expect(events()[0].payload).toMatchObject({ format: 'csv', documents: 0 });
  });

  it('leaves out a song the member cannot open and says so in the README', async () => {
    const res = await get(LGN); // scoped to Nova: S2 is Kilo's
    const files = await unzip(res);
    expect(files['legal-pack.csv']).not.toContain('Dawn');
    expect(files['README.txt']).toContain('1 song on this release is not in this pack');
    expect(events()[0].payload).toMatchObject({ songs: 1, songs_not_included: 1 });
  });

  it('names no private reference, URL or key anywhere in the text it returns', async () => {
    const files = await unzip(await get(LG));
    for (const name of ['README.txt', 'legal-pack.csv']) expect(files[name]).not.toMatch(/r2:\/\/|priv\/|somebody-elses|aaaa1111/);
  });
});

describe('audit', () => {
  it('records release.legal_pack_exported — internal, audit, in the release’s context — with counts and no names', async () => {
    const res = await get(LG);
    await res.arrayBuffer();
    expect(events()).toHaveLength(1);
    const e = events()[0];
    expect(e).toMatchObject({ org_id: L, actor_id: LG, subject_type: 'release', subject_id: R1, artist_id: C1, project_id: LP1, release_id: R1, audit: true, visibility: 'internal' });
    expect(e.payload).toEqual({ format: 'zip', songs: 2, rows: 3, documents: 1, songs_not_included: 0 });
    expect(JSON.stringify(e.payload)).not.toMatch(/Okafor|HYPERLINK/);
  });

  it('hands out nothing when the audit event cannot be written', async () => {
    auditFails = true;
    const res = await get(LG);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(await res.text()).not.toMatch(/Okafor|PK/);
    expect(events()).toEqual([]);
  });

  it('a refused request is not an export: no event', async () => {
    await get(AR);
    await get(LG, XR1);
    expect(events()).toEqual([]);
  });
});
