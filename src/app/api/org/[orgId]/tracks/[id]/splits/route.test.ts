/**
 * The split sheet routes (LABEL-28) — list / create, edit / discard a draft,
 * circulate, supersede, signatures — through the REAL lib/auth/org-access,
 * splits(-store), activity and the in-memory audit functions, against an
 * in-memory database. The 100.0000 rule and the immutability of a circulated
 * sheet are also held by migration 155's triggers (proved against Postgres in
 * supabase/local/checks/155_*.sql); these tests prove the routes refuse first
 * and say why, and that the audit pairs (change + event) stay together.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project, song S1.
 *     LP2: Kilo's Inbox, song S2. S3: a song in no project.
 *     Members: OWN (owner → rights.write), AR (A&R → rights.read),
 *     PRD (producer function → own line), MKT (marketing → none),
 *     SC (A&R scoped to Kilo). External on LP1: EDITOR, VIEWER.
 *   Parties: PN (Nova), PP (PRD’s own party), PK (Kilo), PE (EDITOR’s own party).
 *   L2: song XS1 and party PX. The producer: song PS1 (org_id NULL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const PRD = u(3);
const MKT = u(4);
const SC = u(5);
const EDITOR = u(11);
const VIEWER = u(14);
const STRANGER = u(15);
const X = u(16);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const S3 = t(3);
const XS1 = t(4);
const PS1 = t(5);
const PN = '60000000-0000-4000-8000-0000000000a1';
const PP = '60000000-0000-4000-8000-0000000000a2';
const PK = '60000000-0000-4000-8000-0000000000a3';
const PE = '60000000-0000-4000-8000-0000000000a4';
const PX = '60000000-0000-4000-8000-0000000000a5';

let current: string | null = null;
let db: MemoryDb;
let failAudit = false;
const storage = { stored: [] as { key: string; mime: string; bytes: number }[], deleted: [] as string[] };

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/storage/project-assets', () => ({
  projectAssetBuckets: () => ['priv'],
  storeProjectAsset: async (buffer: Buffer, k: string, mime: string) => {
    storage.stored.push({ key: k, mime, bytes: buffer.length });
    return `r2://priv/${k}`;
  },
  deleteProjectAssetObject: async (r: string) => { storage.deleted.push(r); },
}));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
const track = (id: string, org: string | null, type = 'song', title = 'T') => ({ id, org_id: org, user_id: org ? null : OWN, type, title, song_stage: 'inbox' });
const ext = (user: string, role: string, project = LP1) => ({ org_id: L, project_id: project, user_id: user, role, allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' });
const party = (over: Record<string, unknown>) => ({
  org_id: L, kind: 'person', legal_name: null, email: null, ipi: null, isni: null, pro: null, pro_affiliation: 'unknown',
  publisher_name: null, publisher_ipi: null, contact_id: null, user_id: null, created_at: '2026-10-01', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  failAudit = false;
  storage.stored = [];
  storage.deleted = [];
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(PRD, 'member', ['producer']),
        member(MKT, 'member', ['marketing']),
        member(SC, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }],
      project_members: [ext(EDITOR, 'editor'), ext(VIEWER, 'viewer')],
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
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [track(S1, L, 'song', 'Midnight'), track(S2, L, 'song', 'Dawn'), track(S3, L, 'song', 'Loose'), track(XS1, L2), track(PS1, null)],
      parties: [
        party({ id: PN, display_name: 'Nova', legal_name: 'Nova Okafor', ipi: '00987654321', contact_id: C1 }),
        party({ id: PP, display_name: 'Pierre', legal_name: 'Pierre Producteur', ipi: '00123456789', user_id: PRD }),
        party({ id: PK, display_name: 'Kilo' }),
        party({ id: PE, display_name: 'Eddie', legal_name: 'Eddie Editor', user_id: EDITOR }),
        party({ id: PX, org_id: L2, display_name: 'Xen' }),
      ],
      track_collaborators: [],
      split_sheets: [],
      split_lines: [],
      project_assets: [],
      activity_events: [],
      song_beats: [],
      track_links: [],
      user_profiles: [],
    },
    rpc: auditRpcMemory({ failAudit: () => failAudit }),
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Where = 'collection' | 'sheet' | 'circulate' | 'supersede' | 'signatures';

async function call(where: Where, method: string, as: string | null, org: string, id: string, sheetId?: string, body?: unknown | FormData) {
  current = as;
  const mod = (await import(
    where === 'collection' ? './route' : where === 'sheet' ? './[sheetId]/route' : where === 'circulate' ? './[sheetId]/circulate/route' : where === 'supersede' ? './[sheetId]/supersede/route' : './[sheetId]/signatures/route'
  )) as unknown as Record<string, Handler>;
  const suffix = where === 'collection' ? '' : `/${sheetId}${where === 'sheet' ? '' : `/${where}`}`;
  const url = `https://app.test/api/org/${org}/tracks/${id}/splits${suffix}`;
  const init: ConstructorParameters<typeof NextRequest>[1] =
    method === 'GET' || method === 'DELETE'
      ? method === 'DELETE' ? { method } : undefined
      : body instanceof FormData
        ? { method, body }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(url, init), { params: Promise.resolve({ orgId: org, id, ...(sheetId ? { sheetId } : {}) }) });
}
const list = (as: string | null, org: string, id: string) => call('collection', 'GET', as, org, id);
const create = (as: string | null, org: string, id: string, body: unknown) => call('collection', 'POST', as, org, id, undefined, body);
const edit = (as: string | null, sheetId: string, body: unknown, id = S1) => call('sheet', 'PATCH', as, L, id, sheetId, body);
const discard = (as: string | null, sheetId: string, id = S1) => call('sheet', 'DELETE', as, L, id, sheetId);
const circulate = (as: string | null, sheetId: string, id = S1) => call('circulate', 'POST', as, L, id, sheetId, {});
const supersede = (as: string | null, sheetId: string, id = S1) => call('supersede', 'POST', as, L, id, sheetId, {});
const sign = (as: string | null, sheetId: string, body: unknown, id = S1) => call('signatures', 'POST', as, L, id, sheetId, body);

const sheets = () => db.tables.split_sheets;
const lines = () => db.tables.split_lines;
const events = () => db.tables.activity_events;
const verbs = () => events().map((e) => e.verb);

const L3 = [
  { party_id: PN, role: 'writer', share: '33.3333' },
  { party_id: PP, role: 'writer', share: '33.3333' },
  { party_id: PK, role: 'writer', share: '33.3333' },
];
const L3_OK = [
  { party_id: PN, role: 'writer', share: '33.3334' },
  { party_id: PP, role: 'writer', share: '33.3333' },
  { party_id: PK, role: 'writer', share: '33.3333' },
];

async function draft(lns: unknown[] = L3_OK, kind = 'composition', song = S1): Promise<string> {
  const res = await create(OWN, L, song, { kind, lines: lns });
  expect(res.status).toBe(201);
  return (await res.json()).sheet.id;
}
async function circulated(lns: unknown[] = L3_OK, kind = 'composition', song = S1): Promise<string> {
  const id = await draft(lns, kind, song);
  expect((await circulate(OWN, id, song)).status).toBe(200);
  return id;
}

describe('POST — start a draft', () => {
  it('rights.write starts version 1 with its lines, in integer-exact shares, and records split_sheet.created', async () => {
    const res = await create(OWN, L, S1, { kind: 'composition', note: 'first cut', lines: L3 });
    expect(res.status).toBe(201);
    const { sheet } = await res.json();
    expect(sheet).toMatchObject({ kind: 'composition', version: 1, status: 'draft', total: '99.9999', note: 'first cut', can: { edit: true, circulate: true } });
    expect(sheet.lines.map((l: { share: string }) => l.share)).toEqual(['33.3333', '33.3333', '33.3333']);
    expect(lines().map((l) => l.share)).toEqual([33.3333, 33.3333, 33.3333]);
    expect(events().map((e) => [e.verb, e.visibility, e.audit, e.subject_type, e.song_id, e.project_id, e.artist_id])).toEqual([
      ['split_sheet.created', 'internal', false, 'split_sheet', S1, LP1, C1],
    ]);
    // The event says which sheet, never who owns what.
    expect(JSON.stringify(events()[0].payload)).toBe(JSON.stringify({ kind: 'composition', version: 1 }));
  });

  it('a draft may be empty, and a master sheet is its own sheet', async () => {
    expect((await create(OWN, L, S1, { kind: 'composition' })).status).toBe(201);
    expect((await create(OWN, L, S1, { kind: 'master', lines: [{ party_id: PK, role: 'master_owner', share: 100 }] })).status).toBe(201);
    expect(sheets().map((s) => `${s.kind}/v${s.version}`).sort()).toEqual(['composition/v1', 'master/v1']);
  });

  it('only one draft per song and kind (409)', async () => {
    await draft();
    const res = await create(OWN, L, S1, { kind: 'composition' });
    expect(res.status).toBe(409);
    expect(sheets()).toHaveLength(1);
  });

  it('refuses a bad share, a role of the other kind, a person twice and a party of another org — before writing anything', async () => {
    const bad = (lns: unknown[], status: number, kind = 'composition') => create(OWN, L, S1, { kind, lines: lns }).then((r) => {
      expect(r.status, JSON.stringify(lns)).toBe(status);
    });
    await bad([{ party_id: PN, role: 'writer', share: '33.33333' }], 400); // 5 decimals (schema)
    await bad([{ party_id: PN, role: 'writer', share: '0' }], 400);
    await bad([{ party_id: PN, role: 'writer', share: '100.0001' }], 400);
    await bad([{ party_id: PN, role: 'writer', share: -5 }], 400);
    await bad([{ party_id: PN, role: 'master_owner', share: '100' }], 400);
    await bad([{ party_id: PN, role: 'writer', share: '50' }, { party_id: PN, role: 'writer', share: '50' }], 400);
    await bad([{ party_id: PX, role: 'writer', share: '100' }], 404); // another org's party
    await bad([{ party_id: PN, role: 'writer', share: '100' }], 400, 'master'); // writer on a master sheet
    expect(sheets()).toEqual([]);
    expect(lines()).toEqual([]);
    expect(events()).toEqual([]);
  });

  it('rights.write only: A&R (read), a producer, marketing, an external editor, a stranger and another org’s owner cannot', async () => {
    for (const who of [AR, PRD, MKT, EDITOR, VIEWER, STRANGER, X]) {
      const res = await create(who, L, S1, { kind: 'composition' });
      expect([403, 404], `${who}`).toContain(res.status);
    }
    expect((await create(SC, L, S2, { kind: 'composition' })).status).toBe(403);
    expect((await create(null, L, S1, { kind: 'composition' })).status).toBe(401);
    expect(sheets()).toEqual([]);
  });

  it('a producer’s track, another org’s song and an unknown field are refused', async () => {
    expect([403, 404]).toContain((await create(OWN, L, PS1, { kind: 'composition' })).status);
    expect([403, 404]).toContain((await create(OWN, L, XS1, { kind: 'composition' })).status);
    expect((await create(OWN, L, S1, { kind: 'composition', status: 'circulated' })).status).toBe(400);
    expect((await create(OWN, L, S1, { kind: 'publishing' })).status).toBe(400);
    expect(sheets()).toEqual([]);
  });

  it('a recording that is not a song cannot have a sheet (404, nothing written)', async () => {
    db.tables.tracks.push(track(t(9), L, 'instrumental'));
    expect((await create(OWN, L, t(9), { kind: 'composition' })).status).toBe(404);
    expect(sheets()).toEqual([]);
  });
});

describe('PATCH / DELETE — only a draft', () => {
  it('replaces the whole set of lines and the note in one go, and records split_sheet.updated without shares', async () => {
    const id = await draft(L3);
    const res = await edit(OWN, id, { note: 'fixed', lines: L3_OK });
    expect(res.status).toBe(200);
    const { sheet } = await res.json();
    expect(sheet).toMatchObject({ total: '100', note: 'fixed' });
    expect(lines()).toHaveLength(3);
    const updated = events().find((e) => e.verb === 'split_sheet.updated')!;
    expect(updated.payload).toEqual({ kind: 'composition', version: 1, lines: true, note: true });
  });

  it('keeps the lines in the order they were written, through save and through a new version', async () => {
    const id = await draft([
      { party_id: PK, role: 'writer', share: '10' },
      { party_id: PN, role: 'writer', share: '20' },
      { party_id: PP, role: 'writer', share: '70' },
    ]);
    const order = async (sid: string) => (await (await list(OWN, L, S1)).json()).sheets.find((x: { id: string }) => x.id === sid).lines.map((l: { name: string }) => l.name);
    expect(await order(id)).toEqual(['Kilo', 'Nova', 'Pierre']);
    await edit(OWN, id, { lines: [{ party_id: PP, role: 'writer', share: '70' }, { party_id: PK, role: 'writer', share: '10' }, { party_id: PN, role: 'writer', share: '20' }] });
    expect(await order(id)).toEqual(['Pierre', 'Kilo', 'Nova']);
    await circulate(OWN, id);
    const v2 = (await (await supersede(OWN, id)).json()).sheet.id;
    expect(await order(v2)).toEqual(['Pierre', 'Kilo', 'Nova']);
  });

  it('a note alone leaves the lines; a body that changes nothing is a 400', async () => {
    const id = await draft(L3_OK);
    expect((await edit(OWN, id, { note: null })).status).toBe(200);
    expect(lines()).toHaveLength(3);
    expect(sheets()[0].note).toBeNull();
    expect((await edit(OWN, id, {})).status).toBe(400);
  });

  it('a circulated sheet cannot be edited or discarded: 409, and nothing changes', async () => {
    const id = await circulated();
    const before = JSON.stringify([sheets(), lines()]);
    const eventCount = events().length;
    const res = await edit(OWN, id, { lines: [{ party_id: PN, role: 'writer', share: '100' }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/circulated and can no longer be edited/);
    expect((await edit(OWN, id, { note: 'sneaky' })).status).toBe(409);
    expect((await discard(OWN, id)).status).toBe(409);
    expect(JSON.stringify([sheets(), lines()])).toBe(before);
    expect(events()).toHaveLength(eventCount);
  });

  it('a signed, disputed or superseded sheet is just as closed', async () => {
    const id = await circulated();
    for (const status of ['signed', 'disputed', 'superseded']) {
      sheets().find((s) => s.id === id)!.status = status;
      expect((await edit(OWN, id, { note: 'x' })).status, status).toBe(409);
      expect((await discard(OWN, id)).status, status).toBe(409);
    }
  });

  it('discards a draft with its lines and records split_sheet.deleted', async () => {
    const id = await draft();
    const res = await discard(OWN, id);
    expect(res.status).toBe(200);
    expect(sheets()).toEqual([]);
    expect(events().at(-1)).toMatchObject({ verb: 'split_sheet.deleted', audit: false });
  });

  it('rights.write only; another song’s or org’s sheet id is 404', async () => {
    const id = await draft();
    for (const who of [AR, PRD, EDITOR]) expect([403, 404]).toContain((await edit(who, id, { note: 'x' })).status);
    expect([403, 404]).toContain((await discard(AR, id)).status);
    expect((await edit(OWN, id, { note: 'x' }, S2)).status).toBe(404);
    expect((await edit(OWN, '60000000-0000-4000-8000-00000000ffff', { note: 'x' })).status).toBe(404);
    expect(sheets()[0].note).toBeNull();
  });
});

describe('POST …/circulate — the 100.0000 rule', () => {
  it('33.3333 × 3 cannot circulate: 422 naming the missing 0.0001, still a draft, no event', async () => {
    const id = await draft(L3);
    const res = await circulate(OWN, id);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('The shares add up to 99.9999%; 0.0001% is still unassigned.');
    expect(body).toMatchObject({ total: 999_999, remaining: 1 });
    expect(sheets()[0].status).toBe('draft');
    expect(verbs()).toEqual(['split_sheet.created']);
  });

  it('over 100, an empty sheet: 422 as well', async () => {
    const over = await draft([{ party_id: PN, role: 'writer', share: '60' }, { party_id: PP, role: 'writer', share: '40' }]);
    await edit(OWN, over, { lines: [{ party_id: PN, role: 'writer', share: '60' }, { party_id: PP, role: 'writer', share: '40.0001' }] });
    expect((await circulate(OWN, over)).status).toBe(422);
    const empty = await draft([], 'master');
    const res = await circulate(OWN, empty);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Add at least one line.');
  });

  it('exactly 100 circulates: status, the audit event with the song’s context, and the shares unchanged', async () => {
    const id = await draft(L3_OK);
    const res = await circulate(OWN, id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sheet).toMatchObject({ status: 'circulated', total: '100', can: { edit: false, circulate: false, supersede: true } });
    expect(body.supersededId).toBeNull();
    expect(sheets()[0]).toMatchObject({ status: 'circulated', circulated_by: OWN });
    const ev = events().find((e) => e.verb === 'split_sheet.circulated')!;
    expect(ev).toMatchObject({ audit: true, visibility: 'internal', actor_id: OWN, song_id: S1, project_id: LP1, artist_id: C1, subject_type: 'split_sheet', subject_id: id });
    expect(ev.payload).toEqual({ kind: 'composition', version: 1, lines: 3 });
  });

  it('a second circulate is 409 and writes no second event', async () => {
    const id = await circulated();
    expect((await circulate(OWN, id)).status).toBe(409);
    expect(verbs().filter((v) => v === 'split_sheet.circulated')).toHaveLength(1);
  });

  it('composition and master are separate: a full master sheet does not make a short composition sheet pass', async () => {
    await circulated([{ party_id: PK, role: 'master_owner', share: '100' }], 'master');
    const comp = await draft(L3);
    expect((await circulate(OWN, comp)).status).toBe(422);
  });

  it('if the audit event cannot be written the sheet does NOT move (one transaction)', async () => {
    const id = await draft();
    failAudit = true;
    const res = await circulate(OWN, id);
    expect(res.status).toBe(500);
    expect(sheets()[0].status).toBe('draft');
    expect(verbs()).toEqual(['split_sheet.created']);
  });

  it('only rights.write circulates; 404 for a sheet of another song', async () => {
    const id = await draft();
    for (const who of [AR, PRD, MKT, EDITOR]) expect([403, 404]).toContain((await circulate(who, id)).status);
    expect((await circulate(OWN, id, S2)).status).toBe(404);
    expect(sheets()[0].status).toBe('draft');
  });
});

describe('versions: a new version supersedes the old one', () => {
  it('supersede starts v2 as a draft copy of the lines, unsigned, while v1 stays in force', async () => {
    const v1 = await circulated();
    lines().find((l) => l.split_sheet_id === v1)!.signed_at = '2026-10-02'; // one signature on v1
    const res = await supersede(OWN, v1);
    expect(res.status).toBe(201);
    const { sheet } = await res.json();
    expect(sheet).toMatchObject({ version: 2, status: 'draft', total: '100', signedCount: 0, lineCount: 3 });
    expect(sheets().map((s) => `v${s.version}:${s.status}`).sort()).toEqual(['v1:circulated', 'v2:draft']);
    expect(lines().filter((l) => l.split_sheet_id === v1 && l.signed_at)).toHaveLength(1); // v1's signature untouched
    expect(events().find((e) => e.verb === 'split_sheet.created' && (e.payload as { version: number }).version === 2)!.payload).toMatchObject({ from_version: 1 });
  });

  it('circulating v2 supersedes v1 atomically — one live sheet, two audit events', async () => {
    const v1 = await circulated();
    const v2 = (await (await supersede(OWN, v1)).json()).sheet.id;
    const res = await circulate(OWN, v2);
    expect(res.status).toBe(200);
    expect((await res.json()).supersededId).toBe(v1);
    expect(sheets().map((s) => `v${s.version}:${s.status}`).sort()).toEqual(['v1:superseded', 'v2:circulated']);
    expect(sheets().find((s) => s.id === v1)).toMatchObject({ superseded_by: v2 });
    expect(events().filter((e) => e.audit).map((e) => e.verb)).toEqual(['split_sheet.circulated', 'split_sheet.superseded', 'split_sheet.circulated']);
  });

  it('a signed sheet can be superseded too; a draft, an old version and a second draft cannot', async () => {
    const v1 = await circulated();
    sheets().find((s) => s.id === v1)!.status = 'signed';
    const v2 = (await (await supersede(OWN, v1)).json()).sheet.id;
    expect((await supersede(OWN, v1)).status).toBe(409); // a draft already exists
    expect((await supersede(OWN, v2)).status).toBe(409); // a draft is edited, not superseded
    await circulate(OWN, v2);
    expect((await supersede(OWN, v1)).status).toBe(409); // v1 is already replaced
  });

  it('versions count up per song and kind; the other kind starts at 1', async () => {
    const v1 = await circulated();
    await supersede(OWN, v1);
    await circulated([{ party_id: PK, role: 'master_owner', share: '100' }], 'master');
    expect(sheets().map((s) => `${s.kind}/v${s.version}`).sort()).toEqual(['composition/v1', 'composition/v2', 'master/v1']);
  });

  it('rights.write only', async () => {
    const v1 = await circulated();
    for (const who of [AR, PRD, EDITOR]) expect([403, 404]).toContain((await supersede(who, v1)).status);
    expect(sheets()).toHaveLength(1);
  });
});

describe('GET — who reads which sheets (D2)', () => {
  it('rights.read (owner, A&R) reads every version, every line, the total and the legal data', async () => {
    const v1 = await circulated();
    await supersede(OWN, v1);
    for (const who of [OWN, AR]) {
      const res = await list(who, L, S1);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.me).toMatchObject({ reach: 'all' });
      expect(body.sheets.map((s: { version: number; status: string }) => `v${s.version}:${s.status}`)).toEqual(['v2:draft', 'v1:circulated']);
      const nova = body.sheets[1].lines.find((l: { name: string }) => l.name === 'Nova');
      expect(nova).toMatchObject({ share: '33.3334', legalName: 'Nova Okafor', ipi: '00987654321' });
      expect(body.sheets[1].total).toBe('100');
    }
    expect((await (await list(OWN, L, S1)).json()).me.canWrite).toBe(true);
    expect((await (await list(AR, L, S1)).json()).me.canWrite).toBe(false);
  });

  it('a producer-function member sees only THEIR line, and only once circulated — never a draft', async () => {
    const id = await draft();
    const early = await (await list(PRD, L, S1)).json();
    expect(early.me.reach).toBe('own');
    expect(early.sheets).toEqual([]);
    await circulate(OWN, id);
    const body = await (await list(PRD, L, S1)).json();
    expect(body.sheets).toHaveLength(1);
    const sheet = body.sheets[0];
    expect(sheet.lines).toHaveLength(1);
    expect(sheet.lines[0]).toMatchObject({ name: 'Pierre', share: '33.3333', mine: true, can: { acknowledge: true, uploadSigned: false } });
    expect(sheet.total).toBeUndefined();
    const wire = JSON.stringify(body);
    for (const leak of ['Nova', 'Okafor', '00987654321', 'Kilo', '33.3334', PN, PK]) expect(wire, leak).not.toContain(leak);
  });

  it('an external member reads their own line only; one with no line sees nothing; a stranger is 404', async () => {
    const id = await draft([{ party_id: PN, role: 'writer', share: '50' }, { party_id: PE, role: 'publisher', share: '50' }]);
    await circulate(OWN, id);
    const viewer = await (await list(VIEWER, L, S1)).json();
    expect(viewer.me.reach).toBe('own');
    expect(viewer.sheets).toEqual([]);
    const editor = await (await list(EDITOR, L, S1)).json();
    expect(editor.sheets).toHaveLength(1);
    expect(editor.sheets[0].lines.map((l: { name: string }) => l.name)).toEqual(['Eddie']);
    expect(JSON.stringify(editor)).not.toContain('Nova');
    expect((await list(STRANGER, L, S1)).status).toBe(404);
    expect((await list(EDITOR, L, S2)).status).toBe(404); // a song of a project they are not in
  });

  it('marketing 403; a scoped A&R reads only inside their scope; other org, producer track, signed out', async () => {
    await draft();
    expect((await list(MKT, L, S1)).status).toBe(403);
    expect((await list(SC, L, S1)).status).toBe(404);
    expect((await list(SC, L, S2)).status).toBe(200);
    expect((await list(X, L, S1)).status).toBe(404);
    expect((await list(OWN, L, PS1)).status).toBe(404);
    expect((await list(OWN, L2, S1)).status).toBe(404);
    expect((await list(null, L, S1)).status).toBe(401);
  });

  it('answers no-store and the vocabulary the form needs', async () => {
    const res = await list(OWN, L, S1);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.kinds.map((k: { key: string }) => k.key)).toEqual(['composition', 'master']);
    expect(body.kinds[1].roles).toEqual([{ key: 'master_owner', label: 'Master owner' }]);
  });
});

describe('POST …/signatures', () => {
  const pdf = (name = 'signed.pdf', bytes = 120) => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
    return form;
  };
  const lineOf = (sheetId: string, party: string) => lines().find((l) => l.split_sheet_id === sheetId && l.party_id === party)!;

  it('a person acknowledges their own line; the audit event is recorded; the sheet stays circulated until the last line', async () => {
    const id = await circulated();
    const res = await sign(PRD, id, { method: 'acknowledged', line_id: lineOf(id, PP).id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.complete).toBe(false);
    expect(body.sheet.lines[0]).toMatchObject({ mine: true, signed: true, signatureMethod: 'acknowledged' });
    expect(sheets()[0].status).toBe('circulated');
    expect(lineOf(id, PP)).toMatchObject({ signature_method: 'acknowledged', signed_by: PRD, signature_asset_id: null });
    expect(events().at(-1)).toMatchObject({ verb: 'split_sheet.signed', audit: true, actor_id: PRD, song_id: S1 });
    expect(events().at(-1)!.payload).toEqual({ kind: 'composition', version: 1, method: 'acknowledged', complete: false, lines: 1 });
  });

  it('an external editor acknowledges their own line the same way', async () => {
    const id = await circulated([{ party_id: PN, role: 'writer', share: '50' }, { party_id: PE, role: 'publisher', share: '50' }]);
    const res = await sign(EDITOR, id, { method: 'acknowledged', line_id: lineOf(id, PE).id });
    expect(res.status).toBe(200);
    expect(lineOf(id, PE).signed_by).toBe(EDITOR);
  });

  it('someone else’s line: 404 for a reader with only an own line (it does not exist for them), 403 even for the owner (nobody acknowledges for another)', async () => {
    const id = await circulated();
    const nova = lineOf(id, PN).id;
    expect((await sign(PRD, id, { method: 'acknowledged', line_id: nova })).status).toBe(404);
    expect((await sign(EDITOR, id, { method: 'acknowledged', line_id: nova })).status).toBe(404);
    expect((await sign(OWN, id, { method: 'acknowledged', line_id: nova })).status).toBe(403);
    expect(lines().filter((l) => l.signed_at)).toEqual([]);
    expect(verbs()).not.toContain('split_sheet.signed');
  });

  it('a marketing member is 403, a stranger 404, a line of another sheet 404', async () => {
    const id = await circulated();
    const other = await circulated([{ party_id: PK, role: 'master_owner', share: '100' }], 'master');
    expect((await sign(MKT, id, { method: 'acknowledged', line_id: lineOf(id, PP).id })).status).toBe(403);
    expect((await sign(STRANGER, id, { method: 'acknowledged', line_id: lineOf(id, PP).id })).status).toBe(404);
    expect((await sign(PRD, id, { method: 'acknowledged', line_id: lineOf(other, PK).id })).status).toBe(404);
  });

  it('a draft is not signable (409); neither is a superseded or a signed sheet; a line signs once', async () => {
    const dr = await draft();
    expect((await sign(OWN, dr, pdf())).status).toBe(409);
    const id = await circulated([{ party_id: PK, role: 'master_owner', share: '100' }], 'master');
    expect((await sign(OWN, id, { method: 'acknowledged', line_id: lineOf(id, PK).id })).status).toBe(403); // PK has no account: nobody can acknowledge it
    sheets().find((s) => s.id === id)!.status = 'superseded';
    expect((await sign(OWN, id, pdf())).status).toBe(409);
    // A whole-org producer acknowledges their own line on any song of the org (S2 too).
    const cid = await circulated(L3_OK, 'composition', S2);
    expect((await sign(PRD, cid, { method: 'acknowledged', line_id: lineOf(cid, PP).id }, S2)).status).toBe(200);
  });

  it('a line already signed is 409 and the first signature stands', async () => {
    const id = await circulated();
    const line = lineOf(id, PP).id;
    expect((await sign(PRD, id, { method: 'acknowledged', line_id: line })).status).toBe(200);
    const first = lineOf(id, PP).signed_at;
    expect((await sign(PRD, id, { method: 'acknowledged', line_id: line })).status).toBe(409);
    expect(lineOf(id, PP).signed_at).toBe(first);
    expect(verbs().filter((v) => v === 'split_sheet.signed')).toHaveLength(1);
  });

  it('a signed PDF signs every open line, is stored as a RESTRICTED split_sheet file, and completes the sheet', async () => {
    const id = await circulated();
    const res = await sign(OWN, id, pdf('Midnight splits signed.pdf'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.complete).toBe(true);
    expect(body.sheet).toMatchObject({ status: 'signed', signedCount: 3, lineCount: 3, hasDocument: true });
    const asset = db.tables.project_assets[0];
    expect(asset).toMatchObject({ kind: 'split_sheet', sensitivity: 'restricted', org_id: L, project_id: LP1, user_id: null, created_by: OWN, in_portal: false, mime: 'application/pdf' });
    expect(String(asset.url)).toMatch(new RegExp(`^r2://priv/orgs/${L}/assets/${LP1}/[A-Za-z0-9_-]+\\.pdf$`));
    expect(storage.stored).toHaveLength(1);
    expect(lines().every((l) => l.signature_method === 'upload' && l.signature_asset_id === asset.id)).toBe(true);
    expect(sheets()[0]).toMatchObject({ status: 'signed', document_asset_id: asset.id });
    const audit = events().filter((e) => e.audit).map((e) => e.verb);
    expect(audit).toEqual(['split_sheet.circulated', 'split_sheet.signed']);
    // The file's own event is internal (restricted), and the sheet event never names the file key.
    expect(events().find((e) => e.verb === 'file.uploaded')).toMatchObject({ visibility: 'internal' });
    expect(JSON.stringify(events())).not.toContain('r2://');
  });

  it('a PDF for one line signs that line only', async () => {
    const id = await circulated();
    const form = pdf();
    form.set('line_id', String(lineOf(id, PN).id));
    const res = await sign(OWN, id, form);
    expect(res.status).toBe(200);
    expect((await res.json()).complete).toBe(false);
    expect(lines().filter((l) => l.signed_at).map((l) => l.party_id)).toEqual([PN]);
    expect(sheets()[0].status).toBe('circulated');
  });

  it('only a rights writer uploads: a producer’s own line, an editor and A&R are refused and nothing is stored', async () => {
    const id = await circulated();
    for (const who of [PRD, EDITOR, AR]) {
      const form = pdf();
      form.set('line_id', String(lineOf(id, PP).id));
      expect([403, 404], `${who}`).toContain((await sign(who, id, form)).status);
    }
    expect(storage.stored).toEqual([]);
    expect(db.tables.project_assets).toEqual([]);
    expect(lines().filter((l) => l.signed_at)).toEqual([]);
  });

  it('refuses anything that is not a small PDF, and a song in no project, before storing', async () => {
    const id = await circulated();
    expect((await sign(OWN, id, pdf('signed.png'))).status).toBe(415);
    expect((await sign(OWN, id, pdf('page.html'))).status).toBe(415);
    expect((await sign(OWN, id, pdf('signed.pdf', 0))).status).toBe(415);
    expect((await sign(OWN, id, pdf('big.pdf', 5 * 1024 * 1024))).status).toBe(413);
    const loose = await circulated(L3_OK, 'composition', S3);
    const res = await sign(OWN, loose, pdf(), S3);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Put the song in a project/);
    expect(storage.stored).toEqual([]);
    expect(db.tables.project_assets).toEqual([]);
  });

  it('if the signature cannot be recorded the stored file is removed again (no orphan restricted file)', async () => {
    const id = await circulated();
    failAudit = true;
    const res = await sign(OWN, id, pdf());
    expect(res.status).toBe(500);
    expect(db.tables.project_assets).toEqual([]);
    expect(storage.deleted).toEqual(storage.stored.map((s) => `r2://priv/${s.key}`));
    expect(lines().filter((l) => l.signed_at)).toEqual([]);
    expect(sheets()[0].status).toBe('circulated');
  });

  it('rejects an unknown method and a body that names more than it should', async () => {
    const id = await circulated();
    expect((await sign(PRD, id, { method: 'upload', line_id: lineOf(id, PP).id })).status).toBe(400);
    expect((await sign(PRD, id, { method: 'acknowledged' })).status).toBe(400);
    expect((await sign(PRD, id, { method: 'acknowledged', line_id: lineOf(id, PP).id, actor: OWN })).status).toBe(400);
  });
});

describe('every mutation records an event', () => {
  it('the whole life of a sheet leaves exactly its trail', async () => {
    const id = await draft(L3);
    await edit(OWN, id, { lines: L3_OK });
    await circulate(OWN, id);
    await sign(PRD, id, { method: 'acknowledged', line_id: lines().find((l) => l.party_id === PP)!.id });
    const v2 = (await (await supersede(OWN, id)).json()).sheet.id;
    await circulate(OWN, v2);
    expect(verbs()).toEqual([
      'split_sheet.created',
      'split_sheet.updated',
      'split_sheet.circulated',
      'split_sheet.signed',
      'split_sheet.created',
      'split_sheet.superseded',
      'split_sheet.circulated',
    ]);
    // Every audit-class event is flagged as audit, the everyday ones are not.
    expect(events().map((e) => e.audit)).toEqual([false, false, true, true, false, true, true]);
  });
});
