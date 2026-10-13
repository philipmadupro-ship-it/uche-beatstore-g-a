/**
 * LABEL-41: the artist ↔ label connection, route by route, against the REAL
 * lib/auth/org-access and the real route code on an in-memory database
 * (only storage, mail, rate limits and the audit transaction are faked; the
 * transaction is proven against Postgres in supabase/local/checks/154_*.sql).
 *
 * The cast — TWO label orgs and TWO artist orgs, TWO connections:
 *   LAB   (label)  ── connection C1 ──  ART  (artist)    shares AP1 (demo + finished), not AP2
 *   LAB2  (label)  ── connection C2 ──  ART2 (artist)    shares AP3
 *   LAB people: LO owner · AR A&R (whole org) · MK marketing · SC A&R limited to ANOTHER roster artist
 *   ART people: AO owner · AM ordinary member · EXT an external member of AP2 (a LABEL-21 project member)
 *   L2O owner of LAB2 · STR a stranger
 *
 * The properties: the artist controls what is shared; the label reads and
 * never writes to the artist org; ending it cuts the NEXT request; the label
 * member's OWN permissions and artist scope still apply (marketing hears
 * finished recordings only); the artist org can never reach label objects;
 * another label, an external project member and a stranger are refused; a
 * copied beat keeps provenance and leaves the source untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LAB = id('1', 1);
const LAB2 = id('1', 2);
const ART = id('1', 3);
const ART2 = id('1', 4);
const LO = id('2', 1);
const AR = id('2', 2);
const MK = id('2', 3);
const SC = id('2', 4);
const AO = id('2', 5);
const AM = id('2', 6);
const EXT = id('2', 7);
const L2O = id('2', 8);
const STR = id('2', 9);
const A2O = id('2', 10);
const LC = id('3', 1); // LAB's roster contact standing for ART (set when accepted)
const LC_OTHER = id('3', 2); // another LAB roster artist (SC's scope)
const AP1 = id('4', 1); // shared
const AP2 = id('4', 2); // NOT shared
const AP3 = id('4', 3); // ART2's, shared with LAB2
const LP1 = id('4', 4); // a LAB project
const T_FIN = id('5', 1); // a selected song in AP1: finished mix
const T_DEMO = id('5', 2); // a working demo in AP1
const T_BEAT = id('5', 3); // a beat in AP1
const T_HID = id('5', 4); // in AP2, not shared
const T_ART2 = id('5', 5); // ART2's
const T_LAB = id('5', 6); // a LAB track
const T_PROD = id('5', 7); // the producer-app track of LO
const T_SONG_LINK = id('5', 8); // a song built on T_BEAT
const C1 = id('6', 1);
const C2 = id('6', 2);

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
const copies: { from: string; to: string }[] = [];
const discards: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '127.0.0.1', rateLimit: () => true }));
vi.mock('@/lib/upload/processing', () => ({ enqueueUploadProcessingJob: async () => null, processUploadProcessingJobById: async () => undefined }));
vi.mock('@/lib/storage/org-copy', () => {
  class CopySourceError extends Error {}
  return {
    CopySourceError,
    copyMasterToOrg: async (from: string, to: string) => {
      if (!from.startsWith('r2://priv/')) throw new CopySourceError('That recording cannot be copied');
      const ref = `r2://priv/orgs/${to}/tracks/copy-${copies.length + 1}.mp3`;
      copies.push({ from, to: ref });
      return ref;
    },
    discardCopy: async (ref: string) => {
      discards.push(ref);
    },
  };
});
vi.mock('@/lib/storage/upload', () => {
  const parse = (value: string) => {
    if (!value.startsWith('r2://')) return null;
    const rest = value.slice(5);
    const slash = rest.indexOf('/');
    return slash > 0 ? { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) } : null;
  };
  return {
    parseR2ObjectRef: parse,
    getStoredObject: async (source: string) => {
      const ref = parse(source);
      if (!ref) return null;
      const full = new TextEncoder().encode(`BYTES:${ref.key}`.padEnd(100, '.'));
      return { Body: { transformToWebStream: () => new Blob([full]).stream() }, ContentType: 'audio/mpeg', AcceptRanges: 'bytes', ContentLength: full.length };
    },
  };
});

const member = (org: string, user: string, role: string, functions: string[] = [], scope = 'org') => ({
  org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [],
});
const track = (tid: string, org: string | null, extra: Record<string, unknown> = {}) => ({
  id: tid, org_id: org, user_id: org ? null : LO, title: `T-${tid.slice(-2)}`, type: 'song', song_stage: 'inbox',
  bpm: 140, key: 'F', scale: 'minor', duration_seconds: 120, loudness: -9,
  audio_url: `r2://priv/${tid.slice(-2)}.mp3`, wav_url: `r2://priv/${tid.slice(-2)}.wav`, preview_url: null, peaks_url: null, ...extra,
});

function seed(): MemoryDb {
  return {
    tables: {
      organizations: [
        { id: LAB, name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: null, created_at: '2026-01-01' },
        { id: LAB2, name: 'Other Label', slug: 'other-label', kind: 'label', deleted_at: null, created_at: '2026-01-02' },
        { id: ART, name: 'Nova', slug: 'nova', kind: 'artist', deleted_at: null, created_at: '2026-01-03' },
        { id: ART2, name: 'Kilo', slug: 'kilo', kind: 'artist', deleted_at: null, created_at: '2026-01-04' },
      ],
      org_members: [
        member(LAB, LO, 'owner'),
        member(LAB, AR, 'member', ['a_and_r']),
        member(LAB, MK, 'member', ['marketing']),
        member(LAB, SC, 'member', ['a_and_r'], 'artists'),
        member(LAB2, L2O, 'owner'),
        member(ART, AO, 'owner'),
        member(ART, AM, 'member', ['producer']),
        member(ART2, A2O, 'owner'),
      ],
      member_artist_scopes: [{ org_id: LAB, user_id: SC, contact_id: LC_OTHER }],
      auth_users: [
        { id: AO, email: 'nova@local.test' },
        { id: LO, email: 'owen@local.test' },
      ],
      contacts: [
        { id: LC, org_id: LAB, user_id: null, name: 'Nova (roster)', category: 'artist', artist_org_id: null },
        { id: LC_OTHER, org_id: LAB, user_id: null, name: 'Someone else', category: 'artist', artist_org_id: null },
      ],
      projects: [
        { id: AP1, org_id: ART, user_id: null, name: 'Nova demos', inbox_for_contact_id: null, cover_url: null, status: null, created_at: '2026-02-01' },
        { id: AP2, org_id: ART, user_id: null, name: 'Nova private', inbox_for_contact_id: null, cover_url: null, status: null, created_at: '2026-02-02' },
        { id: AP3, org_id: ART2, user_id: null, name: 'Kilo project', inbox_for_contact_id: null, cover_url: null, status: null, created_at: '2026-02-03' },
        { id: LP1, org_id: LAB, user_id: null, name: 'Label project', inbox_for_contact_id: null, cover_url: null, status: null, created_at: '2026-02-04' },
      ],
      project_tracks: [
        { project_id: AP1, track_id: T_FIN, position: 0 },
        { project_id: AP1, track_id: T_DEMO, position: 1 },
        { project_id: AP1, track_id: T_BEAT, position: 2 },
        { project_id: AP1, track_id: T_SONG_LINK, position: 3 },
        { project_id: AP2, track_id: T_HID, position: 0 },
        { project_id: AP3, track_id: T_ART2, position: 0 },
      ],
      tracks: [
        track(T_FIN, ART, { song_stage: 'selected' }),
        track(T_DEMO, ART, { song_stage: 'inbox' }),
        track(T_BEAT, ART, { type: 'beat', song_stage: null }),
        track(T_SONG_LINK, ART, { song_stage: 'inbox', beat_track_id: T_BEAT }),
        track(T_HID, ART, { song_stage: 'selected' }),
        track(T_ART2, ART2, { song_stage: 'selected' }),
        track(T_LAB, LAB, { song_stage: 'selected' }),
        track(T_PROD, null, { type: 'beat', song_stage: null, user_id: LO }),
      ],
      project_members: [
        { org_id: ART, project_id: AP2, user_id: EXT, role: 'editor', allow_downloads: true, expires_at: null, invitation_id: null, created_at: '2026-10-01' },
      ],
      song_beats: [],
      track_links: [],
      stems: [],
      release_items: [],
      org_connections: [],
      connection_projects: [],
      activity_events: [],
      creator_profiles: [],
      upload_processing_jobs: [],
    },
    rpc: auditRpcMemory(),
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  process.env.R2_PRIVATE_BUCKET_NAME = 'priv';
  process.env.R2_BUCKET_NAME = 'pub';
  process.env.R2_ACCOUNT_ID = 'test-account-id';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  current = null;
  copies.length = 0;
  discards.length = 0;
  db = seed();
  mem = memoryAdmin(db);
});

// ── plumbing ────────────────────────────────────────────────────────────

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const loaders: Record<string, () => Promise<Record<string, unknown>>> = {
  connections: () => import('./[orgId]/connections/route'),
  connection: () => import('./[orgId]/connections/[connectionId]/route'),
  accept: () => import('./[orgId]/connections/[connectionId]/accept/route'),
  projects: () => import('./[orgId]/connections/[connectionId]/projects/route'),
  audio: () => import('./[orgId]/audio/[trackId]/route'),
  copy: () => import('./[orgId]/tracks/copy/route'),
  contacts: () => import('./[orgId]/contacts/route'),
};

async function call(
  route: keyof typeof loaders,
  method: string,
  user: string | null,
  params: Record<string, string>,
  opts: { body?: unknown; query?: string } = {},
) {
  current = user;
  const mod = await loaders[route]();
  const handler = mod[method] as Handler;
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';
  const req = new NextRequest(`https://app.test/api/org/${params.orgId}/x${opts.query ?? ''}`, {
    method,
    ...(hasBody ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body ?? {}) } : {}),
  });
  return handler(req, { params: Promise.resolve(params) });
}

/** An ACTIVE connection C1 (LAB ↔ ART) sharing AP1, with LC as the roster contact. */
function connectC1(extra: Record<string, unknown> = {}) {
  db.tables.org_connections.push({
    id: C1, label_org_id: LAB, artist_org_id: ART, status: 'active', initiated_by: 'label', requested_by: LO, label_contact_id: LC,
    share_mode: 'selected', allow_copies: false, accepted_at: '2026-10-01', ended_at: null, created_at: '2026-10-01', ...extra,
  });
  db.tables.connection_projects.push({ connection_id: C1, project_id: AP1, org_id: ART });
  const contact = db.tables.contacts.find((c) => c.id === LC);
  if (contact) contact.artist_org_id = ART;
}
function connectC2() {
  db.tables.org_connections.push({
    id: C2, label_org_id: LAB2, artist_org_id: ART2, status: 'active', initiated_by: 'artist', requested_by: A2O, label_contact_id: id('3', 9),
    share_mode: 'selected', allow_copies: true, accepted_at: '2026-10-01', ended_at: null, created_at: '2026-10-01',
  });
  db.tables.contacts.push({ id: id('3', 9), org_id: LAB2, user_id: null, name: 'Kilo (roster)', category: 'artist', artist_org_id: ART2 });
  db.tables.connection_projects.push({ connection_id: C2, project_id: AP3, org_id: ART2 });
}

const audio = (user: string | null, org: string, track: string, query = '') =>
  call('audio', 'GET', user, { orgId: org, trackId: track }, { query });
const events = (verb: string, org?: string) => db.tables.activity_events.filter((e) => e.verb === verb && (!org || e.org_id === org));

// ── request → accept → share ────────────────────────────────────────────

describe('requesting and accepting', () => {
  it('a label owner asks an artist org by slug; both orgs get connection.requested; the answer is 202', async () => {
    const res = await call('connections', 'POST', LO, { orgId: LAB }, { body: { slug: 'nova' } });
    expect(res.status).toBe(202);
    expect(db.tables.org_connections).toHaveLength(1);
    expect(db.tables.org_connections[0]).toMatchObject({ label_org_id: LAB, artist_org_id: ART, status: 'requested', initiated_by: 'label', share_mode: 'selected', allow_copies: false });
    expect(events('connection.requested').map((e) => e.org_id).sort()).toEqual([LAB, ART].sort());
  });

  it('by the email of an owner too', async () => {
    const res = await call('connections', 'POST', LO, { orgId: LAB }, { body: { email: 'Nova@local.test' } });
    expect(res.status).toBe(202);
    expect(db.tables.org_connections[0]).toMatchObject({ artist_org_id: ART });
  });

  it('an unknown slug, the wrong kind, an unknown email and a duplicate all read the same and write nothing more', async () => {
    await call('connections', 'POST', LO, { orgId: LAB }, { body: { slug: 'nova' } });
    const before = JSON.stringify(db.tables.org_connections);
    for (const body of [{ slug: 'nobody' }, { slug: 'other-label' }, { email: 'ghost@local.test' }, { slug: 'nova' }]) {
      const res = await call('connections', 'POST', LO, { orgId: LAB }, { body });
      expect(res.status, JSON.stringify(body)).toBe(202);
      expect(await res.json()).toEqual({ requested: true });
    }
    expect(JSON.stringify(db.tables.org_connections)).toBe(before);
  });

  it('needs org.manage on a whole-org view: an A&R, a limited admin-less member and an outsider are refused', async () => {
    for (const user of [AR, MK, SC]) {
      expect((await call('connections', 'POST', user, { orgId: LAB }, { body: { slug: 'nova' } })).status).toBe(403);
    }
    expect((await call('connections', 'POST', STR, { orgId: LAB }, { body: { slug: 'nova' } })).status).toBe(403);
    expect((await call('connections', 'POST', null, { orgId: LAB }, { body: { slug: 'nova' } })).status).toBe(401);
    expect(db.tables.org_connections).toHaveLength(0);
  });

  it('slug XOR email, strictly', async () => {
    expect((await call('connections', 'POST', LO, { orgId: LAB }, { body: {} })).status).toBe(400);
    expect((await call('connections', 'POST', LO, { orgId: LAB }, { body: { slug: 'nova', email: 'a@b.co' } })).status).toBe(400);
    expect((await call('connections', 'POST', LO, { orgId: LAB }, { body: { slug: 'nova', extra: 1 } })).status).toBe(400);
  });

  it('the starter cannot accept its own request; a third org cannot; the other side can, and gets a roster contact', async () => {
    await call('connections', 'POST', LO, { orgId: LAB }, { body: { slug: 'nova' } });
    const conn = db.tables.org_connections[0].id as string;
    expect((await call('accept', 'POST', LO, { orgId: LAB, connectionId: conn })).status).toBe(404);
    expect((await call('accept', 'POST', L2O, { orgId: LAB2, connectionId: conn })).status).toBe(404);
    expect((await call('accept', 'POST', AM, { orgId: ART, connectionId: conn })).status).toBe(403); // ordinary member: no org.manage
    expect(db.tables.org_connections[0].status).toBe('requested');

    expect((await call('accept', 'POST', AO, { orgId: ART, connectionId: conn })).status).toBe(200);
    expect(db.tables.org_connections[0].status).toBe('active');
    const contact = db.tables.contacts.find((c) => c.artist_org_id === ART);
    expect(contact).toMatchObject({ org_id: LAB, user_id: null, name: 'Nova', category: 'artist' });
    expect(db.tables.org_connections[0].label_contact_id).toBe(contact!.id);
    expect(events('connection.accepted')).toHaveLength(2);
    // Accepting shares nothing.
    expect(db.tables.connection_projects).toHaveLength(0);
  });

  it('an artist org asks a label and the label owner accepts it', async () => {
    expect((await call('connections', 'POST', AO, { orgId: ART }, { body: { slug: 'night-shift' } })).status).toBe(202);
    const conn = db.tables.org_connections[0];
    expect(conn).toMatchObject({ label_org_id: LAB, artist_org_id: ART, initiated_by: 'artist' });
    expect((await call('accept', 'POST', AO, { orgId: ART, connectionId: conn.id as string })).status).toBe(404);
    expect((await call('accept', 'POST', LO, { orgId: LAB, connectionId: conn.id as string })).status).toBe(200);
    expect(conn.status).toBe('active');
  });
});

describe('what is shared is the ARTIST side’s', () => {
  beforeEach(() => connectC1({ share_mode: 'selected' }));

  it('the artist owner selects projects; the label side finds nothing at that route', async () => {
    const res = await call('connection', 'PATCH', AO, { orgId: ART, connectionId: C1 }, { body: { project_ids: [AP1, AP2] } });
    expect(res.status).toBe(200);
    expect(db.tables.connection_projects.map((r) => r.project_id).sort()).toEqual([AP1, AP2].sort());
    expect(events('share.created', ART)).toHaveLength(1);
    expect(events('share.created', LAB)).toHaveLength(0);

    // The label owner holds org.manage and still finds nothing; an A&R lacks it.
    expect((await call('connection', 'PATCH', LO, { orgId: LAB, connectionId: C1 }, { body: { share_mode: 'all' } })).status).toBe(404);
    expect((await call('connection', 'PATCH', AR, { orgId: LAB, connectionId: C1 }, { body: { share_mode: 'all' } })).status).toBe(403);
    expect(db.tables.org_connections[0].share_mode).toBe('selected');
  });

  it('only projects of the artist org can be shared (another org’s, a label’s)', async () => {
    for (const project of [AP3, LP1]) {
      const res = await call('connection', 'PATCH', AO, { orgId: ART, connectionId: C1 }, { body: { project_ids: [project] } });
      expect(res.status).toBe(400);
    }
    expect(db.tables.connection_projects.map((r) => r.project_id)).toEqual([AP1]);
  });

  it('an ordinary artist-org member, another artist org and an external project member cannot change it', async () => {
    expect((await call('connection', 'PATCH', AM, { orgId: ART, connectionId: C1 }, { body: { share_mode: 'all' } })).status).toBe(403);
    expect((await call('connection', 'PATCH', A2O, { orgId: ART2, connectionId: C1 }, { body: { share_mode: 'all' } })).status).toBe(404);
    expect((await call('connection', 'PATCH', EXT, { orgId: ART, connectionId: C1 }, { body: { share_mode: 'all' } })).status).toBe(403);
    expect((await call('connection', 'PATCH', STR, { orgId: ART, connectionId: C1 }, { body: { share_mode: 'all' } })).status).toBe(403);
    expect(db.tables.org_connections[0].share_mode).toBe('selected');
  });

  it('GET: the artist owner sees what each label can reach; the label owner sees no project list; an ordinary member is refused', async () => {
    const artist = await (await call('connections', 'GET', AO, { orgId: ART })).json();
    expect(artist.connections).toHaveLength(1);
    expect(artist.connections[0]).toMatchObject({ id: C1, status: 'active', side: 'artist', other: { name: 'Night Shift', slug: 'night-shift' }, projectIds: [AP1], shareMode: 'selected', allowCopies: false });
    expect(artist.projects.map((p: { id: string }) => p.id).sort()).toEqual([AP1, AP2].sort());

    const label = await (await call('connections', 'GET', LO, { orgId: LAB })).json();
    expect(label.connections[0]).toMatchObject({ id: C1, side: 'label', other: { name: 'Nova', slug: 'nova' }, projectIds: null, rosterContactId: LC });
    expect(label.projects).toBeUndefined();

    expect((await call('connections', 'GET', AM, { orgId: ART })).status).toBe(403);
    // A label A&R sees the connection; one limited to ANOTHER roster artist sees none.
    expect((await (await call('connections', 'GET', AR, { orgId: LAB })).json()).connections).toHaveLength(1);
    expect((await (await call('connections', 'GET', SC, { orgId: LAB })).json()).connections).toHaveLength(0);
    // Nothing of another pair leaks.
    expect(JSON.stringify(label)).not.toContain(ART2);
    expect((await call('connections', 'GET', STR, { orgId: ART })).status).toBe(403);
  });
});

// ── what a connected label member can reach ─────────────────────────────

describe('a connected label member', () => {
  beforeEach(() => {
    connectC1();
    connectC2();
  });

  it('an A&R hears the artist’s shared demo AND the finished song, through the label’s own audio route', async () => {
    for (const t of [T_DEMO, T_FIN, T_BEAT]) {
      const res = await audio(AR, LAB, t);
      expect(res.status, t).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(await (await audio(AR, LAB, T_DEMO)).text()).toContain('BYTES:');
  });

  it('marketing hears finished recordings only (D4, their own capabilities)', async () => {
    expect((await audio(MK, LAB, T_FIN)).status).toBe(200);
    expect((await audio(MK, LAB, T_DEMO)).status).toBe(403);
    expect((await audio(MK, LAB, T_BEAT)).status).toBe(403);
  });

  it('nothing outside the shared projects: the artist’s other project, another artist org’s recording, a label track via the wrong org', async () => {
    expect((await audio(AR, LAB, T_HID)).status).toBe(404);
    expect((await audio(AR, LAB, T_ART2)).status).toBe(404);
    expect((await audio(AR, LAB, T_PROD)).status).toBe(404);
    // A track of the artist org is not reachable by naming ANOTHER org in the path.
    expect((await audio(AR, LAB2, T_FIN)).status).toBe(404);
    expect((await audio(AR, ART, T_FIN)).status).toBe(404);
  });

  it('a member limited to ANOTHER roster artist, another label, a stranger and signed-out callers get nothing', async () => {
    expect((await audio(SC, LAB, T_FIN)).status).toBe(404);
    expect((await audio(L2O, LAB, T_FIN)).status).toBe(404);
    expect((await audio(L2O, LAB2, T_FIN)).status).toBe(404);
    expect((await audio(STR, LAB, T_FIN)).status).toBe(404);
    expect((await audio(null, LAB, T_FIN)).status).toBe(401);
  });

  it('a limited member WITH the connection’s roster artist in scope hears it', async () => {
    db.tables.member_artist_scopes.push({ org_id: LAB, user_id: SC, contact_id: LC });
    expect((await audio(SC, LAB, T_DEMO)).status).toBe(200);
  });

  it('streams only: no download, no WAV, no stems', async () => {
    expect((await audio(AR, LAB, T_FIN, '?download=1')).status).toBe(403);
    expect((await audio(AR, LAB, T_FIN, '?variant=wav')).status).toBe(403);
    expect((await audio(AR, LAB, T_FIN, '?variant=stem:vocals')).status).toBe(403);
    expect((await audio(AR, LAB, T_FIN, '?variant=preview')).status).toBe(404); // none exists, and not a leak of another file
  });

  it('the artist org’s own people and external members keep their own paths, and cross nothing', async () => {
    expect((await audio(AO, ART, T_FIN)).status).toBe(200);
    expect((await audio(AM, ART, T_FIN)).status).toBe(200);
    // The external member of AP2 reaches AP2’s recordings in the artist org, as before, and nothing of the label.
    expect((await audio(EXT, ART, T_HID)).status).toBe(200);
    expect((await audio(EXT, ART, T_FIN)).status).toBe(404);
    expect((await audio(EXT, LAB, T_FIN)).status).toBe(404);
    expect((await audio(EXT, LAB, T_LAB)).status).toBe(404);
  });

  it('the artist org can never reach the LABEL’s objects through the connection', async () => {
    expect((await audio(AO, LAB, T_LAB)).status).toBe(404);
    expect((await audio(AO, ART, T_LAB)).status).toBe(404);
    expect((await call('projects', 'GET', AO, { orgId: ART, connectionId: C1 })).status).toBe(404);
    expect((await call('projects', 'GET', AO, { orgId: LAB, connectionId: C1 })).status).toBe(403);
    expect((await call('contacts', 'GET', AO, { orgId: LAB })).status).toBe(403);
  });

  it('LIST: the shared projects and the recordings THIS member may hear', async () => {
    const ar = await (await call('projects', 'GET', AR, { orgId: LAB, connectionId: C1 })).json();
    expect(ar.artist).toEqual({ name: 'Nova', slug: 'nova' });
    expect(ar.projects.map((p: { id: string }) => p.id)).toEqual([AP1]);
    expect(ar.projects[0].recordings.map((r: { id: string }) => r.id).sort()).toEqual([T_BEAT, T_DEMO, T_FIN, T_SONG_LINK].sort());
    // Built field by field: no stored reference, no ids of members or contacts, no stages.
    const text = JSON.stringify(ar);
    for (const leak of ['r2://', 'audio_url', 'wav_url', AO, AM, LC, 'song_stage', 'inbox', ART, T_HID, AP2]) expect(text, leak).not.toContain(leak);

    const mk = await (await call('projects', 'GET', MK, { orgId: LAB, connectionId: C1 })).json();
    expect(mk.projects[0].recordings.map((r: { id: string }) => r.id)).toEqual([T_FIN]);
  });

  it('LIST: another label’s connection, a limited member, the artist side and a stranger find nothing', async () => {
    expect((await call('projects', 'GET', L2O, { orgId: LAB2, connectionId: C1 })).status).toBe(404);
    expect((await call('projects', 'GET', L2O, { orgId: LAB, connectionId: C1 })).status).toBe(403);
    expect((await call('projects', 'GET', SC, { orgId: LAB, connectionId: C1 })).status).toBe(404);
    expect((await call('projects', 'GET', STR, { orgId: LAB, connectionId: C1 })).status).toBe(403);
    expect((await call('projects', 'GET', null, { orgId: LAB, connectionId: C1 })).status).toBe(401);
    // The second connection is its own world.
    const l2 = await (await call('projects', 'GET', L2O, { orgId: LAB2, connectionId: C2 })).json();
    expect(l2.projects.map((p: { id: string }) => p.id)).toEqual([AP3]);
    expect(JSON.stringify(l2)).not.toContain(AP1);
  });

  it('the artist narrowing the share, or switching to all, applies on the next request', async () => {
    await call('connection', 'PATCH', AO, { orgId: ART, connectionId: C1 }, { body: { project_ids: [] } });
    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
    expect((await (await call('projects', 'GET', LO, { orgId: LAB, connectionId: C1 })).json()).projects).toEqual([]);

    await call('connection', 'PATCH', AO, { orgId: ART, connectionId: C1 }, { body: { share_mode: 'all' } });
    expect((await audio(AR, LAB, T_HID)).status).toBe(200);
    expect((await (await call('projects', 'GET', LO, { orgId: LAB, connectionId: C1 })).json()).projects).toHaveLength(2);
    // …and not one of another artist org’s.
    expect((await audio(AR, LAB, T_ART2)).status).toBe(404);
  });

  it('the label never writes to the artist org: nothing in the artist org changes through any label call', async () => {
    const snapshot = () => JSON.stringify([db.tables.projects.filter((p) => p.org_id === ART), db.tables.tracks.filter((t) => t.org_id === ART), db.tables.project_tracks, db.tables.project_members]);
    const before = snapshot();
    await audio(AR, LAB, T_FIN);
    await call('projects', 'GET', AR, { orgId: LAB, connectionId: C1 });
    await call('connection', 'PATCH', LO, { orgId: LAB, connectionId: C1 }, { body: { share_mode: 'all', allow_copies: true } });
    await call('copy', 'POST', LO, { orgId: LAB }, { body: { source: { kind: 'connection', track_id: T_BEAT } } });
    expect(snapshot()).toBe(before);
    expect(mem.writes.filter((w) => w.op !== 'rpc' && w.table !== 'activity_events').every((w) => w.table === 'tracks' || w.table === 'upload_processing_jobs')).toBe(true);
    for (const w of mem.writes.filter((x) => x.table === 'tracks')) for (const row of w.rows) expect(row.org_id).toBe(LAB);
  });
});

// ── ending ──────────────────────────────────────────────────────────────

describe('ending a connection', () => {
  beforeEach(() => connectC1({ allow_copies: true }));

  it('the label ends it: the very next request is a 404 everywhere, the roster contact is released, both orgs record it', async () => {
    expect((await audio(AR, LAB, T_FIN)).status).toBe(200);
    const res = await call('connection', 'DELETE', LO, { orgId: LAB, connectionId: C1 });
    expect(res.status).toBe(200);
    expect(db.tables.org_connections[0].status).toBe('ended');
    expect(db.tables.connection_projects).toHaveLength(0);
    expect(db.tables.contacts.find((c) => c.id === LC)!.artist_org_id).toBeNull();
    expect(events('connection.ended').map((e) => e.org_id).sort()).toEqual([LAB, ART].sort());

    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
    expect((await audio(LO, LAB, T_FIN)).status).toBe(404);
    expect((await call('projects', 'GET', LO, { orgId: LAB, connectionId: C1 })).status).toBe(404);
    expect((await call('copy', 'POST', LO, { orgId: LAB }, { body: { source: { kind: 'connection', track_id: T_BEAT } } })).status).toBe(404);
    expect((await (await call('connections', 'GET', LO, { orgId: LAB })).json()).connections).toEqual([]);
    // Ending twice is a 404, not an error.
    expect((await call('connection', 'DELETE', LO, { orgId: LAB, connectionId: C1 })).status).toBe(404);
  });

  it('the artist can end it too', async () => {
    expect((await call('connection', 'DELETE', AO, { orgId: ART, connectionId: C1 })).status).toBe(200);
    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
  });

  it('an A&R, an ordinary artist member, another org and an external member cannot end it', async () => {
    for (const [user, org] of [[AR, LAB], [AM, ART], [L2O, LAB2], [A2O, ART2], [EXT, ART], [STR, LAB]] as const) {
      const res = await call('connection', 'DELETE', user, { orgId: org, connectionId: C1 });
      expect([403, 404], `${user}`).toContain(res.status);
    }
    expect(db.tables.org_connections[0].status).toBe('active');
  });

  it('soft-deleting the artist org, or the label, cuts access without anyone touching the connection', async () => {
    db.tables.organizations.find((o) => o.id === ART)!.deleted_at = '2026-10-10';
    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
    expect((await call('projects', 'GET', LO, { orgId: LAB, connectionId: C1 })).status).toBe(404);
    db.tables.organizations.find((o) => o.id === ART)!.deleted_at = null;
    expect((await audio(AR, LAB, T_FIN)).status).toBe(200);
    db.tables.organizations.find((o) => o.id === LAB)!.deleted_at = '2026-10-10';
    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
  });

  it('removing the member from the label ends their reach on the next request (membership is live)', async () => {
    db.tables.org_members = db.tables.org_members.filter((m) => m.user_id !== AR);
    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
  });

  it('a pending request grants nothing, and a declined one stays declined', async () => {
    db.tables.org_connections[0].status = 'requested';
    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
    expect((await call('connection', 'DELETE', AO, { orgId: ART, connectionId: C1 })).status).toBe(200); // declines
    expect(db.tables.org_connections[0].status).toBe('declined');
    expect((await audio(AR, LAB, T_FIN)).status).toBe(404);
  });
});

// ── copying (D6) ────────────────────────────────────────────────────────

describe('"Use in a label song" copies, with provenance', () => {
  const copyBody = (track_id: string, extra: Record<string, unknown> = {}) => ({ source: { kind: 'connection', track_id }, ...extra });

  it('is off until the artist allows copies', async () => {
    connectC1();
    const res = await call('copy', 'POST', LO, { orgId: LAB }, { body: copyBody(T_BEAT) });
    expect(res.status).toBe(403);
    expect(copies).toHaveLength(0);
    expect(db.tables.tracks.filter((t) => t.org_id === LAB)).toHaveLength(1);
  });

  it('copies a shared beat into the label: a NEW track, its own file, provenance, the source untouched', async () => {
    connectC1({ allow_copies: true });
    const source = JSON.stringify(db.tables.tracks.find((t) => t.id === T_BEAT));
    const res = await call('copy', 'POST', AR, { orgId: LAB }, { body: copyBody(T_BEAT, { project_id: LP1 }) });
    expect(res.status).toBe(201);
    const { track } = await res.json();
    const copy = db.tables.tracks.find((t) => t.id === track.id)!;
    expect(copy).toMatchObject({ org_id: LAB, user_id: null, created_by: AR, type: 'beat', title: 'T-03', bpm: 140, key: 'F' });
    expect(copy.id).not.toBe(T_BEAT);
    expect(copy.audio_url).toMatch(new RegExp(`^r2://priv/orgs/${LAB}/tracks/`));
    expect(copy.audio_url).not.toBe('r2://priv/03.mp3');
    expect(copy.provenance).toMatchObject({ source_org_id: ART, source_track_id: T_BEAT, copied_by: AR });
    expect(typeof (copy.provenance as { copied_at: string }).copied_at).toBe('string');
    expect(db.tables.project_tracks).toContainEqual(expect.objectContaining({ project_id: LP1, track_id: copy.id }));
    // The source is exactly as it was: same row, same files, still in its project.
    expect(JSON.stringify(db.tables.tracks.find((t) => t.id === T_BEAT))).toBe(source);
    expect(db.tables.tracks.filter((t) => t.org_id === ART)).toHaveLength(5);
    // The response is a view: no stored reference.
    expect(JSON.stringify(track)).not.toContain('r2://');
    // Audit: recorded in the LABEL org only.
    expect(events('recording.copied', LAB)).toHaveLength(1);
    expect(events('recording.copied', ART)).toHaveLength(0);
  });

  it('only what the member may hear and write: marketing (no catalog.write), a demo they cannot hear, a song, an unshared track', async () => {
    connectC1({ allow_copies: true });
    expect((await call('copy', 'POST', MK, { orgId: LAB }, { body: copyBody(T_BEAT) })).status).toBe(403);
    expect((await call('copy', 'POST', AR, { orgId: LAB }, { body: copyBody(T_DEMO) })).status).toBe(400); // a song is not copied
    expect((await call('copy', 'POST', AR, { orgId: LAB }, { body: copyBody(T_HID) })).status).toBe(404);
    expect((await call('copy', 'POST', AR, { orgId: LAB }, { body: copyBody(T_ART2) })).status).toBe(404);
    expect((await call('copy', 'POST', SC, { orgId: LAB }, { body: copyBody(T_BEAT) })).status).toBe(404);
    expect((await call('copy', 'POST', L2O, { orgId: LAB2 }, { body: copyBody(T_BEAT) })).status).toBe(404);
    expect((await call('copy', 'POST', AO, { orgId: ART }, { body: copyBody(T_BEAT) })).status).toBe(403); // an artist org copies nothing
    expect((await call('copy', 'POST', null, { orgId: LAB }, { body: copyBody(T_BEAT) })).status).toBe(401);
    expect(copies).toHaveLength(0);
  });

  it('a destination project must be a label project the member may write', async () => {
    connectC1({ allow_copies: true });
    expect((await call('copy', 'POST', AR, { orgId: LAB }, { body: copyBody(T_BEAT, { project_id: AP1 }) })).status).toBe(404);
    expect(copies).toHaveLength(0);
  });

  it('a producer copies their OWN recording; someone else’s, or an org’s, is a 404', async () => {
    const res = await call('copy', 'POST', LO, { orgId: LAB }, { body: { source: { kind: 'producer', track_id: T_PROD } } });
    expect(res.status).toBe(201);
    const copy = db.tables.tracks.find((t) => t.provenance && (t.provenance as { source_track_id: string }).source_track_id === T_PROD)!;
    expect(copy).toMatchObject({ org_id: LAB, user_id: null });
    expect(copy.provenance).toMatchObject({ source_org_id: null, copied_by: LO });
    expect(db.tables.tracks.find((t) => t.id === T_PROD)).toMatchObject({ org_id: null, user_id: LO });

    for (const [user, track] of [[AR, T_PROD], [LO, T_BEAT], [LO, T_LAB]] as const) {
      expect((await call('copy', 'POST', user, { orgId: LAB }, { body: { source: { kind: 'producer', track_id: track } } })).status, `${user} ${track}`).toBe(404);
    }
  });

  it('a failed audit event removes the copy again', async () => {
    connectC1({ allow_copies: true });
    const before = db.tables.tracks.length;
    // recordEvent for an audit verb inserts into activity_events; make that fail.
    const realFrom = mem.client.from;
    mem.client.from = ((table: string) => {
      const q = realFrom(table);
      if (table === 'activity_events') {
        (q as unknown as { insert: () => unknown }).insert = () => ({ select: async () => ({ data: null, error: { message: 'boom' } }), then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(r) });
      }
      return q;
    }) as typeof mem.client.from;
    const res = await call('copy', 'POST', LO, { orgId: LAB }, { body: copyBody(T_BEAT) });
    mem.client.from = realFrom;
    expect(res.status).toBe(500);
    expect(db.tables.tracks).toHaveLength(before);
    expect(discards.length).toBeGreaterThan(0);
  });
});

// ── the connection list on the roster ───────────────────────────────────

describe('the roster', () => {
  it('marks the roster contact that stands for a connected artist org', async () => {
    connectC1();
    const body = await (await call('contacts', 'GET', LO, { orgId: LAB }, { query: '?view=roster' })).json();
    const nova = body.contacts.find((c: { id: string }) => c.id === LC);
    expect(nova.connected).toEqual({ connectionId: C1, orgName: 'Nova', orgSlug: 'nova' });
    expect(body.contacts.find((c: { id: string }) => c.id === LC_OTHER).connected).toBeUndefined();
  });

  it('shows nothing once it has ended', async () => {
    connectC1({ status: 'ended' });
    const body = await (await call('contacts', 'GET', LO, { orgId: LAB }, { query: '?view=roster' })).json();
    expect(body.contacts.every((c: { connected?: unknown }) => c.connected === undefined)).toBe(true);
  });
});
