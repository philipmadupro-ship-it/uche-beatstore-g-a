/**
 * /api/org/[orgId]/contacts[/id] and /api/org/[orgId]/members/artists
 * (LABEL-10), run through the REAL lib/auth/org-access against an in-memory
 * database holding two label orgs, an artist org and the producer's own CRM
 * row. Two orgs, two scopes:
 *
 *   L  (label)  : owner OWN; A&R AR (whole org); A&R SC (artists: C1);
 *                 roster artist ART (artists: none); FIN (finance: no
 *                 catalog.read)
 *   L2 (label)  : owner X; contact D1
 *   A  (artist) : owner AOWN; its one artist ASELF
 *   producer CRM: PC1 (user_id = the producer, org_id NULL)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const A = '10000000-0000-4000-8000-000000000003';
const OWN = '20000000-0000-4000-8000-000000000001';
const AR = '20000000-0000-4000-8000-000000000002';
const SC = '20000000-0000-4000-8000-000000000003';
const ART = '20000000-0000-4000-8000-000000000004';
const FIN = '20000000-0000-4000-8000-000000000005';
const X = '20000000-0000-4000-8000-000000000006';
const AOWN = '20000000-0000-4000-8000-000000000007';
const AMGR = '20000000-0000-4000-8000-000000000008';
const MK = '20000000-0000-4000-8000-000000000009';
const AENG = '30000000-0000-4000-8000-0000000000e5';
const PRODUCER = '20000000-0000-4000-8000-0000000000aa';
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const D1 = '30000000-0000-4000-8000-0000000000d1';
const ASELF = '30000000-0000-4000-8000-0000000000a5';
const PC1 = '30000000-0000-4000-8000-0000000000b1';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

function contact(id: string, org: string | null, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, org_id: org, user_id: org ? null : PRODUCER, name, email: `${name.toLowerCase()}@test.dev`,
    phone: null, role: null, label: null, category: 'artist', secondary_category: null, genre: null, country: null,
    city: null, instagram: null, twitter: null, website: null, avatar_url: null, notes: null, crm_status: null,
    created_at: '2026-10-01T00:00:00Z', ...extra,
  };
}

function member(org: string, user: string, role: string, functions: string[] = [], scope = 'org') {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null },
        { id: L2, kind: 'label', deleted_at: null },
        { id: A, kind: 'artist', deleted_at: null },
      ],
      org_members: [
        member(L, OWN, 'owner'),
        member(L, AR, 'member', ['a_and_r']),
        member(L, SC, 'member', ['a_and_r'], 'artists'),
        member(L, ART, 'artist', [], 'artists'),
        member(L, FIN, 'member', ['finance']),
        member(L, MK, 'member', ['marketing'], 'artists'),
        member(L2, X, 'owner'),
        member(A, AOWN, 'owner'),
        member(A, AMGR, 'member', ['artist_manager'], 'artists'),
      ],
      member_artist_scopes: [
        { org_id: L, user_id: SC, contact_id: C1 },
        { org_id: L, user_id: MK, contact_id: C1 },
        { org_id: A, user_id: AMGR, contact_id: AENG },
      ],
      contacts: [
        contact(C1, L, 'Nova'),
        contact(C2, L, 'Kilo'),
        contact(D1, L2, 'Other'),
        contact(ASELF, A, 'Self'),
        contact(AENG, A, 'Engineer', { category: 'engineer' }),
        contact(PC1, null, 'Crm'),
      ],
      activity_events: [],
    },
    unique: { contacts: [['org_id', 'email']], member_artist_scopes: [['org_id', 'user_id', 'contact_id']] },
  };
  mem = memoryAdmin(db);
});

type Res = { status: number; json: Record<string, unknown> };

async function call(
  as: string | null,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  org: string,
  contactId?: string,
  body?: unknown,
  query = '',
): Promise<Res> {
  current = as;
  const url = `https://app.test/api/org/${org}/contacts${contactId ? `/${contactId}` : ''}${query}`;
  const req = new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const mod = (contactId ? await import('./[contactId]/route') : await import('./route')) as unknown as Record<
    string,
    (r: NextRequest, c: unknown) => Promise<Response>
  >;
  const res = await mod[method](req, { params: Promise.resolve({ orgId: org, contactId }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function artists(as: string, method: 'GET' | 'PUT', org: string, body?: unknown, query = ''): Promise<Res> {
  current = as;
  const req = new NextRequest(`https://app.test/api/org/${org}/members/artists${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const mod = await import('../members/artists/route');
  const res = await mod[method](req, { params: Promise.resolve({ orgId: org }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const names = (r: Res) => ((r.json.contacts ?? []) as { name: string }[]).map((c) => c.name).sort();

describe('GET /contacts: the org directory, by scope', () => {
  it('401 without a session', async () => {
    expect((await call(null, 'GET', L)).status).toBe(401);
  });

  it("the owner and an org-wide member see the org's contacts, never the producer's CRM or another org's", async () => {
    expect(names(await call(OWN, 'GET', L))).toEqual(['Kilo', 'Nova']);
    expect(names(await call(AR, 'GET', L))).toEqual(['Kilo', 'Nova']);
  });

  it('an artists-scoped member lists only their contacts', async () => {
    expect(names(await call(SC, 'GET', L))).toEqual(['Nova']);
  });

  it('an artists-scoped member with zero contacts sees nothing', async () => {
    const r = await call(ART, 'GET', L);
    expect(r.status).toBe(200);
    expect(names(r)).toEqual([]);
  });

  it('403 without catalog.read, and for a member of another org', async () => {
    expect((await call(FIN, 'GET', L)).status).toBe(403);
    expect((await call(X, 'GET', L)).status).toBe(403);
  });

  it('never returns user_id or org_id, and marks the roster', async () => {
    const r = await call(OWN, 'GET', L);
    const first = (r.json.contacts as Record<string, unknown>[])[0];
    expect(first).not.toHaveProperty('user_id');
    expect(first).not.toHaveProperty('org_id');
    expect(first.in_roster).toBe(true);
    expect(first.groups).toEqual(['artist']);
  });

  it('?view=roster keeps the artists and drops the rest of the directory', async () => {
    db.tables.contacts.push(contact('30000000-0000-4000-8000-0000000000e1', L, 'Engineer', { category: 'engineer' }));
    expect(names(await call(OWN, 'GET', L))).toEqual(['Engineer', 'Kilo', 'Nova']);
    expect(names(await call(OWN, 'GET', L, undefined, undefined, '?view=roster'))).toEqual(['Kilo', 'Nova']);
  });
});

describe('GET /contacts/[id]: 404 outside org and scope', () => {
  it('an in-scope contact is readable', async () => {
    const r = await call(SC, 'GET', L, C1);
    expect(r.status).toBe(200);
    expect((r.json.contact as { name: string }).name).toBe('Nova');
  });

  it('an out-of-scope contact is 404 to an artists-scoped member', async () => {
    expect((await call(SC, 'GET', L, C2)).status).toBe(404);
    expect((await call(ART, 'GET', L, C1)).status).toBe(404);
  });

  it('scope is checked before the capability, so a 403 never confirms an out-of-scope id exists', async () => {
    // Marketing reads the catalogue but may not write it.
    expect((await call(MK, 'PATCH', L, C2, { city: 'x' })).status).toBe(404);
    expect((await call(MK, 'PATCH', L, '30000000-0000-4000-8000-0000000000ff', { city: 'x' })).status).toBe(404);
    expect((await call(MK, 'PATCH', L, C1, { city: 'x' })).status).toBe(403);
  });

  it("a producer CRM contact (org_id IS NULL) is 404 even to an org owner", async () => {
    expect((await call(OWN, 'GET', L, PC1)).status).toBe(404);
  });

  it("cross-org ids are rejected: another org's contact is 404, also through its own owner on the wrong org's URL", async () => {
    expect((await call(OWN, 'GET', L, D1)).status).toBe(404);
    expect((await call(X, 'GET', L, D1)).status).toBe(404);
    expect((await call(X, 'GET', L2, D1)).status).toBe(200);
  });

  it('a malformed id is 404', async () => {
    expect((await call(OWN, 'GET', L, 'nope')).status).toBe(404);
  });
});

describe('POST /contacts', () => {
  it('adds an org contact: org from the context, no user_id, email normalised, event recorded', async () => {
    const r = await call(AR, 'POST', L, undefined, { name: 'Vee', email: 'Vee@Example.COM', category: 'singer' });
    expect(r.status).toBe(201);
    const created = r.json.contact as { id: string; email: string; in_roster: boolean };
    expect(created.email).toBe('vee@example.com');
    expect(created.in_roster).toBe(true);
    const row = db.tables.contacts.find((c) => c.id === created.id)!;
    expect(row.org_id).toBe(L);
    expect(row.user_id).toBeNull();
    expect(db.tables.activity_events).toMatchObject([
      { org_id: L, actor_id: AR, verb: 'contact.created', subject_type: 'contact', subject_id: created.id, artist_id: created.id },
    ]);
  });

  it('409 for an email already in this directory; the same email in another org is fine', async () => {
    expect((await call(AR, 'POST', L, undefined, { name: 'Nova 2', email: 'NOVA@test.dev' })).status).toBe(409);
    expect((await call(X, 'POST', L2, undefined, { name: 'Nova', email: 'nova@test.dev' })).status).toBe(201);
  });

  it('refuses org_id / user_id in the body (strict contract)', async () => {
    expect((await call(AR, 'POST', L, undefined, { name: 'x', org_id: L2 })).status).toBe(400);
    expect((await call(AR, 'POST', L, undefined, { name: 'x', user_id: PRODUCER })).status).toBe(400);
  });

  it("refuses the CRM's private notes / crm_status: the roster artist reads their own contact (D5)", async () => {
    expect((await call(AR, 'POST', L, undefined, { name: 'x', notes: 'renegotiate at 12%' })).status).toBe(400);
    expect((await call(AR, 'PATCH', L, C1, { notes: 'difficult' })).status).toBe(400);
    expect((await call(AR, 'PATCH', L, C1, { crm_status: 'cold' })).status).toBe(400);
    db.tables.contacts.find((c) => c.id === C1)!.notes = 'set by hand';
    const seen = await call(ART, 'GET', L, undefined, undefined, '');
    expect(JSON.stringify(seen.json)).not.toContain('set by hand');
    const own = await call(OWN, 'GET', L, C1);
    expect(own.json.contact).not.toHaveProperty('notes');
    expect(own.json.contact).not.toHaveProperty('crm_status');
  });

  it('403 for an artists-scoped member (they could not see what they add) and without catalog.write', async () => {
    expect((await call(SC, 'POST', L, undefined, { name: 'x' })).status).toBe(403);
    expect((await call(ART, 'POST', L, undefined, { name: 'x' })).status).toBe(403);
    expect((await call(FIN, 'POST', L, undefined, { name: 'x' })).status).toBe(403);
    expect(db.tables.contacts).toHaveLength(6);
  });

  it('an artist org keeps one artist: a second is 409, an engineer is fine', async () => {
    expect((await call(AOWN, 'POST', A, undefined, { name: 'Twin', category: 'artist' })).status).toBe(409);
    expect((await call(AOWN, 'POST', A, undefined, { name: 'Eng', category: 'engineer' })).status).toBe(201);
  });
});

describe('PATCH /contacts/[id]', () => {
  it('edits within scope, 404 outside it and across orgs', async () => {
    expect((await call(SC, 'PATCH', L, C1, { city: 'Lagos' })).status).toBe(200);
    expect((await call(SC, 'PATCH', L, C2, { city: 'Lagos' })).status).toBe(404);
    expect((await call(OWN, 'PATCH', L, D1, { city: 'Lagos' })).status).toBe(404);
    expect((await call(OWN, 'PATCH', L, PC1, { city: 'Lagos' })).status).toBe(404);
    expect(db.tables.contacts.find((c) => c.id === PC1)!.city).toBeNull();
    expect(db.tables.contacts.find((c) => c.id === D1)!.city).toBeNull();
  });

  it('400 for an empty patch; 409 for a duplicate email', async () => {
    expect((await call(AR, 'PATCH', L, C1, {})).status).toBe(400);
    expect((await call(AR, 'PATCH', L, C1, { email: 'kilo@test.dev' })).status).toBe(409);
  });

  it("the one-artist rule is judged on the whole org, not a scoped member's slice", async () => {
    // AMGR sees only the engineer, not the org's artist; turning the
    // engineer into an artist would still make two.
    expect((await call(AMGR, 'PATCH', A, AENG, { category: 'artist' })).status).toBe(409);
    expect((await call(AMGR, 'PATCH', A, AENG, { genre: 'house' })).status).toBe(200);
  });

  it("an artist org's artist cannot stop being its artist", async () => {
    expect((await call(AOWN, 'PATCH', A, ASELF, { category: 'producer' })).status).toBe(409);
    expect((await call(AOWN, 'PATCH', A, ASELF, { category: 'singer' })).status).toBe(200);
  });
});

describe('DELETE /contacts/[id]', () => {
  it('an org-wide member removes a contact; a scoped one cannot', async () => {
    expect((await call(SC, 'DELETE', L, C1)).status).toBe(403);
    expect((await call(AR, 'DELETE', L, C2)).status).toBe(200);
    expect(db.tables.contacts.some((c) => c.id === C2)).toBe(false);
  });

  it("404 across orgs and for a producer contact; an artist org's artist stays", async () => {
    expect((await call(OWN, 'DELETE', L, D1)).status).toBe(404);
    expect((await call(OWN, 'DELETE', L, PC1)).status).toBe(404);
    expect((await call(AOWN, 'DELETE', A, ASELF)).status).toBe(409);
    expect(db.tables.contacts).toHaveLength(6);
  });
});

describe('/members/artists: the roster picker', () => {
  it("replaces a scoped member's artists, which immediately changes what they see", async () => {
    const r = await artists(OWN, 'PUT', L, { user_id: SC, contact_ids: [C2] });
    expect(r.status).toBe(200);
    expect(r.json.contact_ids).toEqual([C2]);
    expect(names(await call(SC, 'GET', L))).toEqual(['Kilo']);
    expect((await call(SC, 'GET', L, C1)).status).toBe(404);
    expect(db.tables.activity_events).toMatchObject([
      { verb: 'member.artists_changed', audit: true, subject_id: SC, payload: { added: [C2], removed: [C1], count: 1 } },
    ]);
  });

  it('an empty list means the member sees nothing', async () => {
    expect((await artists(OWN, 'PUT', L, { user_id: SC, contact_ids: [] })).status).toBe(200);
    expect(names(await call(SC, 'GET', L))).toEqual([]);
  });

  it("refuses another org's contact, a producer contact, a directory entry who is not an artist, and a member who sees the whole org", async () => {
    const ENG = '30000000-0000-4000-8000-0000000000e9';
    db.tables.contacts.push(contact(ENG, L, 'Mixer', { category: 'engineer' }));
    const foreign = await artists(OWN, 'PUT', L, { user_id: SC, contact_ids: [C1, D1, PC1, ENG] });
    expect(foreign.status).toBe(400);
    expect((foreign.json.contact_ids as string[]).sort()).toEqual([D1, PC1, ENG].sort());
    expect((await artists(OWN, 'PUT', L, { user_id: SC, contact_ids: Array.from({ length: 151 }, (_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })).status).toBe(400);
    expect((await artists(OWN, 'PUT', L, { user_id: AR, contact_ids: [C1] })).status).toBe(400);
    expect(db.tables.member_artist_scopes.filter((r) => r.user_id === SC)).toEqual([{ org_id: L, user_id: SC, contact_id: C1 }]);
  });

  it('needs members.manage to change; a member of another org is refused', async () => {
    expect((await artists(AR, 'PUT', L, { user_id: SC, contact_ids: [C2] })).status).toBe(403);
    expect((await artists(SC, 'PUT', L, { user_id: SC, contact_ids: [C1, C2] })).status).toBe(403);
    expect((await artists(X, 'PUT', L, { user_id: SC, contact_ids: [] })).status).toBe(403);
  });

  it('404 for someone who is not a member of the org', async () => {
    expect((await artists(OWN, 'PUT', L, { user_id: X, contact_ids: [] })).status).toBe(404);
  });

  it('a member reads their own list; reading someone else needs members.manage', async () => {
    const own = await artists(SC, 'GET', L, undefined, `?user_id=${SC}`);
    expect(own.json).toEqual({ user_id: SC, scoped: true, contact_ids: [C1] });
    expect((await artists(SC, 'GET', L, undefined, `?user_id=${AR}`)).status).toBe(403);
    expect((await artists(OWN, 'GET', L, undefined, `?user_id=${ART}`)).json).toEqual({ user_id: ART, scoped: true, contact_ids: [] });
    expect((await artists(OWN, 'GET', L, undefined, `?user_id=${AR}`)).json).toEqual({ user_id: AR, scoped: false, contact_ids: [] });
  });
});
