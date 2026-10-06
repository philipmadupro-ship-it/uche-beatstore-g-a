/**
 * The org upload wrapper (LABEL-14): `/api/org/[orgId]/upload/{init,part,
 * complete,abort,status,targets}`, run through the REAL lib/auth/org-access,
 * lib/storage/upload-sessions, lib/labelos/inbox-project-store and
 * links-store `addOrgLink` against an in-memory database. Storage (multipart,
 * object delete, the audio sniff) and the processing job are faked.
 *
 *   L (label): artists C1 (Nova) and C2 (Kilo). S1: Nova's song in LP1
 *   (C1 via project_contacts); B1: a beat in LP1. Members: owner, A&R,
 *   finance (no catalog.write), A&R scoped to C2.
 *   L2: artist D1, song XS1. The producer: contact PC1 (org_id NULL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const FIN = u(3);
const AR_C2 = u(4);
const STRANGER = u(5);
const X = u(6);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const D1 = '30000000-0000-4000-8000-0000000000d1';
const PC1 = '30000000-0000-4000-8000-0000000000e1';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const S1 = '50000000-0000-4000-8000-000000000001';
const B1 = '50000000-0000-4000-8000-000000000002';
const XS1 = '50000000-0000-4000-8000-000000000003';
const S1M = '50000000-0000-4000-8000-000000000004';
// LABEL-21: external project members. S3 sits in two projects, each shared with a different person.
const EXT_E = u(7); // editor of LP2
const EXT_V = u(8); // viewer of LP2
const EXT_E2 = u(9); // editor of LP3 only
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const LP3 = '40000000-0000-4000-8000-0000000000a3';
const S3 = '50000000-0000-4000-8000-000000000005';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
/** Make writes to one table fail, to prove the rollback. */
let failWritesTo: string | null = null;

const storage = vi.hoisted(() => ({
  inits: [] as { fileName: string; keyPrefix?: string }[],
  deleted: [] as string[],
  enqueued: [] as Record<string, unknown>[],
  sniffOk: true,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q = mem.client.from(table);
      if (failWritesTo !== table) return q;
      const err = async () => ({ data: null, error: { message: `${table} is down` } });
      const broken = { ...q, then: (ok: (v: unknown) => unknown) => err().then(ok), single: err, maybeSingle: err, select: () => broken };
      return { ...q, insert: () => broken, upsert: () => broken };
    },
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/storage/multipart', () => ({
  DEFAULT_PART_SIZE: 8 * 1024 * 1024,
  MIN_PART_SIZE: 5 * 1024 * 1024,
  MAX_PARTS: 10_000,
  initMultipart: async (fileName: string, _ct: string, opts: { keyPrefix?: string } = {}) => {
    storage.inits.push({ fileName, keyPrefix: opts.keyPrefix });
    return { uploadId: `up-${storage.inits.length}`, key: `${opts.keyPrefix ?? 'tracks'}/obj${storage.inits.length}.wav` };
  },
  abortMultipart: async () => {},
  listParts: async () => [{ PartNumber: 1, ETag: '"e1"', Size: 10 }],
  completeMultipart: async ({ key }: { key: string }) => `r2://priv/${key}`,
  getUploadPartUrl: async ({ key, partNumber }: { key: string; partNumber: number }) => `https://r2.example/${key}?part=${partNumber}`,
  uploadPart: async ({ partNumber }: { partNumber: number }) => ({ PartNumber: partNumber, ETag: '"e"' }),
}));
vi.mock('@/lib/storage/upload', () => ({ deleteStoredObject: async (ref: string) => { storage.deleted.push(ref); } }));
vi.mock('@/lib/upload/verify-stored-audio', () => ({
  verifyStoredAudio: async () => (storage.sniffOk ? { ok: true } : { ok: false, format: 'unknown' }),
}));
vi.mock('@/lib/upload/processing', () => ({
  enqueueUploadProcessingJob: async (job: Record<string, unknown>) => { storage.enqueued.push(job); return 'job-1'; },
  processUploadProcessingJobById: async () => null,
}));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  failWritesTo = null;
  storage.inits.length = 0;
  storage.deleted.length = 0;
  storage.enqueued.length = 0;
  storage.sniffOk = true;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(FIN, 'member', ['finance']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: D1, org_id: L2, user_id: null, name: 'L2 artist', category: 'artist' },
        { id: PC1, org_id: null, user_id: OWN, name: 'CRM artist', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, status: 'in_progress', created_at: '2026-01-01' },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null, status: 'in_progress', created_at: '2026-01-01' },
      ],
      activity_events: [],
      project_members: [],
      project_contacts: [{ project_id: LP1, contact_id: C1 }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: B1, position: 1 },
        { project_id: LP1, track_id: S1M, position: 2 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [
        { id: S1, org_id: L, user_id: null, type: 'song', song_stage: 'in_review', title: 'Nova single', created_at: '2026-01-02' },
        { id: B1, org_id: L, user_id: null, type: 'beat', song_stage: null, title: 'Pool beat', created_at: '2026-01-01' },
        { id: S1M, org_id: L, user_id: null, type: 'song', song_stage: null, title: 'Nova single (master)', created_at: '2026-01-03' },
        { id: XS1, org_id: L2, user_id: null, type: 'song', song_stage: 'inbox', title: 'L2 song', created_at: '2026-01-01' },
      ],
      track_links: [{ from_track_id: S1, to_track_id: S1M, user_id: null, relation: 'master', position: 0 }],
      upload_sessions: [],
    },
    unique: {
      projects: [['inbox_for_contact_id']],
      project_tracks: [['project_id', 'track_id']],
      track_links: [['from_track_id', 'to_track_id']],
    },
  };
  mem = memoryAdmin(db);
});

type Body = Record<string, unknown>;
const ROUTES = {
  init: () => import('./init/route'),
  complete: () => import('./complete/route'),
  abort: () => import('./abort/route'),
  part: () => import('./part/route'),
};
async function call(route: 'init' | 'complete' | 'abort' | 'part', as: string | null, org: string, body: Body, method = 'POST') {
  current = as;
  const req = new NextRequest(`https://app.test/api/org/${org}/upload/${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const mod = (await ROUTES[route]()) as unknown as Record<string, unknown>;
  return (mod[method] as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({ orgId: org }) });
}
async function targets(as: string | null, org: string, contactId: string) {
  current = as;
  const mod = await import('./targets/route');
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/upload/targets?contactId=${contactId}`), { params: Promise.resolve({ orgId: org }) });
}
async function status(as: string | null, org: string, sessionId: string) {
  current = as;
  const mod = await import('./status/route');
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/upload/status?sessionId=${sessionId}`), { params: Promise.resolve({ orgId: org }) });
}

const song = (contactId = C1) => ({ kind: 'song', contactId });
const link = (relation: string, songId = S1) => ({ kind: 'link', songId, relation });
const file = (name = 'Night Shift 140 Fm.wav') => ({ fileName: name, fileSize: 10 });

async function upload(as: string, intent: Body, name?: string) {
  const init = await call('init', as, L, { ...file(name), as: intent });
  expect(init.status).toBe(200);
  const { sessionId } = await init.json();
  return call('complete', as, L, { sessionId, as: intent });
}

const tracksOf = (projectId: string) => db.tables.project_tracks.filter((r) => r.project_id === projectId).map((r) => r.track_id);

describe('init: who may upload what', () => {
  it('a new song for an artist: the master key is under orgs/<org>/tracks, the session belongs to the caller', async () => {
    const res = await call('init', AR, L, { ...file(), as: song() });
    expect(res.status).toBe(200);
    expect(storage.inits).toEqual([{ fileName: 'Night Shift 140 Fm.wav', keyPrefix: `orgs/${L}/tracks` }]);
    expect(db.tables.upload_sessions).toHaveLength(1);
    expect(db.tables.upload_sessions[0]).toMatchObject({ user_id: AR, track_type: 'song', project_id: null, replace_track_id: null });
    expect(String(db.tables.upload_sessions[0].object_key).startsWith(`orgs/${L}/tracks/`)).toBe(true);
  });

  it.each([
    ['signed out', null, L, song(), 401],
    ['a stranger', STRANGER, L, song(), 404],
    ['finance (no catalog.write)', FIN, L, song(), 403],
    ['an artist outside the member\'s scope', AR_C2, L, song(C1), 404],
    ['another org\'s artist', AR, L, song(D1), 404],
    ['a producer CRM contact', OWN, L, song(PC1), 404],
    ['another org\'s song', AR, L, link('master', XS1), 404],
    ['a song outside scope', AR_C2, L, link('master'), 404],
    ['a beat, not a song', AR, L, link('loop', B1), 409],
    ['a song-type master (material, not a song)', AR, L, link('version', S1M), 409],
  ] as const)('refuses %s', async (_name, who, org, intent, statusCode) => {
    const res = await call('init', who, org, { ...file(), as: intent as unknown as Body });
    expect(res.status).toBe(statusCode);
    expect(storage.inits).toEqual([]);
  });

  it('scoped to an artist: may upload for that artist', async () => {
    expect((await call('init', AR_C2, L, { ...file(), as: song(C2) })).status).toBe(200);
  });

  it('refuses a file the upload path refuses, before anything is stored', async () => {
    expect((await call('init', AR, L, { fileName: 'notes.txt', fileSize: 10, as: song() })).status).toBe(415);
    expect(storage.inits).toEqual([]);
  });

  it('a relation that is not an upload relation (beat) is a 400', async () => {
    expect((await call('init', AR, L, { ...file(), as: link('beat') })).status).toBe(400);
  });
});

describe('complete: a new song lands in its artist\'s Inbox', () => {
  it('3 uploads for one artist → 3 songs in ONE Inbox project, created on first need', async () => {
    const ids: string[] = [];
    for (const name of ['One 140 Fm.wav', 'Two.wav', 'Three.mp3']) {
      const res = await upload(AR, song(C2), name);
      expect(res.status).toBe(200);
      ids.push((await res.json()).track.id);
    }
    const inboxes = db.tables.projects.filter((p) => p.inbox_for_contact_id === C2);
    expect(inboxes).toHaveLength(1);
    // No owner (142): no producer route — all filter on user_id — can reach it.
    expect(inboxes[0]).toMatchObject({ org_id: L, name: 'Inbox · Kilo', status: 'in_progress', user_id: null });
    expect(tracksOf(inboxes[0].id as string)).toEqual(ids);
    const rows = db.tables.tracks.filter((t) => ids.includes(t.id as string));
    expect(rows.map((t) => [t.org_id, t.user_id, t.created_by, t.type, t.song_stage])).toEqual(
      ids.map(() => [L, null, AR, 'song', 'inbox']),
    );
    // The filename is metadata here too.
    expect(rows[0]).toMatchObject({ title: 'One', bpm: 140, key: 'F' });
    expect(storage.enqueued.map((j) => j.trackId)).toEqual(ids);
  });

  it('answers a view with no stored reference, playable through the LABEL-13 route', async () => {
    const res = await upload(AR, song());
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/r2:\/\/|orgs\/.*\/tracks/);
    expect(body.track).toMatchObject({ orgId: L, type: 'song', songStage: 'inbox', playUrl: `/api/org/${L}/audio/${body.track.id}` });
  });

  it('reuses an archived Inbox, reopening it', async () => {
    db.tables.projects.push({ id: '40000000-0000-4000-8000-0000000000c9', org_id: L, user_id: null, name: 'Inbox · Nova', inbox_for_contact_id: C1, status: 'archived', created_at: '2026-01-01' });
    const res = await upload(OWN, song(C1));
    expect(res.status).toBe(200);
    expect(db.tables.projects.filter((p) => p.inbox_for_contact_id === C1).map((p) => p.status)).toEqual(['in_progress']);
  });
});

describe('complete: material is linked to its song in the same request', () => {
  it.each([
    ['master', 'song'],
    ['demo', 'song'],
    ['instrumental', 'instrumental'],
    ['loop', 'loop'],
    ['topline', 'topline'],
    ['version', 'song'],
  ])('as %s: a track_links row from the song, the song\'s projects, type %s, no stage', async (relation, type) => {
    const res = await upload(AR, link(relation));
    expect(res.status).toBe(200);
    const { track } = await res.json();
    expect(track.linkedTo).toEqual({ songId: S1, relation });
    expect(db.tables.track_links.find((l) => l.to_track_id === track.id)).toMatchObject({ from_track_id: S1, relation, user_id: null, position: 1 });
    expect(db.tables.tracks.find((t) => t.id === track.id)).toMatchObject({ org_id: L, type, song_stage: null });
    // In the song's project, so an artist-scoped member reaches it like the song.
    expect(tracksOf(LP1)).toContain(track.id);
    expect(track.projectIds).toEqual([LP1]);
  });
});

describe('complete: the upload is recorded (LABEL-19)', () => {
  it('a new song is song.created for its artist, in the Inbox, visible to the creative side', async () => {
    const res = await upload(AR, song(C2), 'One 140 Fm.wav');
    const { track } = await res.json();
    expect(db.tables.activity_events).toEqual([
      expect.objectContaining({
        org_id: L,
        actor_id: AR,
        verb: 'song.created',
        subject_type: 'track',
        subject_id: track.id,
        artist_id: C2,
        project_id: track.projectIds[0],
        song_id: track.id,
        audit: false,
        visibility: 'artist',
        payload: { title: 'One', song_stage: 'inbox' },
      }),
    ]);
  });

  it('material linked to a song is recording.uploaded against that song, not a second song', async () => {
    const res = await upload(AR, link('demo'));
    const { track } = await res.json();
    expect(db.tables.activity_events).toEqual([
      expect.objectContaining({
        verb: 'recording.uploaded',
        subject_id: track.id,
        song_id: S1,
        project_id: LP1,
        visibility: 'artist',
        payload: { relation: 'demo', type: 'song' },
      }),
    ]);
  });

  it('an upload that fails records nothing', async () => {
    const sid = await initAs(AR, link('master'));
    failWritesTo = 'track_links';
    expect((await call('complete', AR, L, { sessionId: sid, as: link('master') })).status).toBe(500);
    storage.sniffOk = false;
    expect((await call('complete', AR, L, { sessionId: await initAs(AR), as: song() })).status).toBe(415);
    expect(db.tables.activity_events ?? []).toEqual([]);
  });
});

async function initAs(who: string, intent: Body = song()) {
  const res = await call('init', who, L, { ...file(), as: intent });
  return (await res.json()).sessionId as string;
}

describe('complete: the session gate', () => {
  it('another member\'s session is 404', async () => {
    const sid = await initAs(AR);
    expect((await call('complete', OWN, L, { sessionId: sid, as: song() })).status).toBe(404);
  });

  it('a producer upload session is never completed into an org', async () => {
    db.tables.upload_sessions.push({
      session_id: 'producer-sid', user_id: AR, upload_id: 'u', object_key: 'tracks/x.wav', file_name: 'x.wav', file_size: 10,
      content_type: 'audio/wav', part_size: 10, total_parts: 1, parts: [], track_type: 'song', project_id: null,
      replace_track_id: null, status: 'in_progress', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    expect((await call('complete', AR, L, { sessionId: 'producer-sid', as: song() })).status).toBe(404);
    expect((await call('part', AR, L, { sessionId: 'producer-sid', partNumber: 1 })).status).toBe(404);
  });

  it('a session of org L is 404 through org L2 (even for a member of both)', async () => {
    db.tables.org_members.push(member(AR, 'member', ['a_and_r'], 'org', L2));
    const sid = await initAs(AR);
    expect((await call('complete', AR, L2, { sessionId: sid, as: song(D1) })).status).toBe(404);
    expect((await status(AR, L2, sid)).status).toBe(404);
  });

  it('an upload started as a song cannot be completed as linked material', async () => {
    const sid = await initAs(AR);
    expect((await call('complete', AR, L, { sessionId: sid, as: link('loop') })).status).toBe(409);
    expect(db.tables.tracks).toHaveLength(4);
  });

  it('a file that is not audio is refused and nothing is written', async () => {
    const sid = await initAs(AR);
    storage.sniffOk = false;
    expect((await call('complete', AR, L, { sessionId: sid, as: song() })).status).toBe(415);
    expect(db.tables.tracks).toHaveLength(4);
  });

  it('a placement failure rolls the track and the object back', async () => {
    const sid = await initAs(AR, link('master'));
    failWritesTo = 'track_links';
    const res = await call('complete', AR, L, { sessionId: sid, as: link('master') });
    expect(res.status).toBe(500);
    expect(db.tables.tracks).toHaveLength(4);
    expect(storage.deleted).toHaveLength(1);
    expect(storage.deleted[0].startsWith(`r2://priv/orgs/${L}/tracks/`)).toBe(true);
    expect(storage.enqueued).toEqual([]);
  });

  it('losing catalog.write between init and complete stops the upload', async () => {
    const sid = await initAs(AR);
    db.tables.org_members.find((m) => m.user_id === AR && m.org_id === L)!.cap_revokes = ['catalog.write'];
    expect((await call('complete', AR, L, { sessionId: sid, as: song() })).status).toBe(403);
  });
});

describe('part / status / abort run behind the org session gate', () => {
  it('signs parts for the caller\'s org session, and nobody else\'s', async () => {
    const res = await call('init', AR, L, { ...file(), as: song() });
    const { sessionId } = await res.json();
    const sign = await call('part', AR, L, { sessionId, partNumbers: [1] });
    expect(sign.status).toBe(200);
    expect((await sign.json()).urls['1']).toMatch(new RegExp(`orgs/${L}/tracks/`));
    expect((await call('part', OWN, L, { sessionId, partNumbers: [1] })).status).toBe(404);
    expect((await call('part', FIN, L, { sessionId, partNumbers: [1] })).status).toBe(403);
    expect((await status(AR, L, sessionId)).status).toBe(200);
    expect((await call('abort', OWN, L, { sessionId })).status).toBe(404);
    expect((await call('abort', AR, L, { sessionId })).status).toBe(200);
    expect(db.tables.upload_sessions).toHaveLength(0);
  });
});

describe('targets: an artist\'s songs to add material to', () => {
  it('lists the artist\'s songs (not linked recordings, not beats)', async () => {
    const res = await targets(AR, L, C1);
    expect(res.status).toBe(200);
    expect((await res.json()).songs).toEqual([{ id: S1, title: 'Nova single', songStage: 'in_review' }]);
  });

  it('is scoped like the artist: out of scope 404, another org 404, no catalog.write 403', async () => {
    expect((await targets(AR_C2, L, C1)).status).toBe(404);
    expect((await targets(AR, L, D1)).status).toBe(404);
    expect((await targets(FIN, L, C1)).status).toBe(403);
    expect((await targets(AR, L, 'not-a-uuid')).status).toBe(404);
  });
});

// ── LABEL-21: an external project member uploads a version, into THEIR project only ──

describe('external project members (LABEL-21)', () => {
  const version = (songId = S3) => link('version', songId);
  // S3 sits in two org projects, each shared with a different person; no artist is linked to either.
  beforeEach(() => {
    db.tables.projects.push(
      { id: LP2, org_id: L, user_id: null, name: 'Uche × Producer X', inbox_for_contact_id: null, status: 'in_progress', created_at: '2026-01-01' },
      { id: LP3, org_id: L, user_id: null, name: 'Second room', inbox_for_contact_id: null, status: 'in_progress', created_at: '2026-01-01' },
    );
    db.tables.tracks.push({ id: S3, org_id: L, user_id: null, type: 'song', song_stage: 'in_review', title: 'Uche × Producer X (song)', created_at: '2026-01-04' });
    db.tables.project_tracks.push({ project_id: LP2, track_id: S3, position: 0 }, { project_id: LP3, track_id: S3, position: 0 });
    db.tables.project_members.push(
      { org_id: L, project_id: LP2, user_id: EXT_E, role: 'editor', allow_downloads: false, expires_at: null },
      { org_id: L, project_id: LP2, user_id: EXT_V, role: 'viewer', allow_downloads: true, expires_at: null },
      { org_id: L, project_id: LP3, user_id: EXT_E2, role: 'editor', allow_downloads: false, expires_at: null },
    );
  });
  const events = (verb: string) => db.tables.activity_events.filter((e) => e.verb === verb);

  it('an editor adds a version of a song in their project: init, parts, complete — in THEIR project only, credited to them', async () => {
    const init = await call('init', EXT_E, L, { ...file('v2.wav'), as: version() });
    expect(init.status).toBe(200);
    expect(storage.inits).toEqual([{ fileName: 'v2.wav', keyPrefix: `orgs/${L}/tracks` }]);
    const { sessionId } = await init.json();

    // The parts and the status are theirs, behind the same session gate.
    const sign = await call('part', EXT_E, L, { sessionId, partNumbers: [1] });
    expect(sign.status).toBe(200);
    expect((await status(EXT_E, L, sessionId)).status).toBe(200);

    const done = await call('complete', EXT_E, L, { sessionId, as: version() });
    expect(done.status).toBe(200);
    const { track } = await done.json();
    // The song sits in LP2 AND LP3; the version lands in LP2, the one shared with them.
    expect(track.projectIds).toEqual([LP2]);
    expect(tracksOf(LP2)).toContain(track.id);
    expect(tracksOf(LP3)).not.toContain(track.id);
    // An org row with no owner, credited to the uploader (D3), linked as a version of the song.
    expect(db.tables.tracks.find((t) => t.id === track.id)).toMatchObject({ org_id: L, user_id: null, created_by: EXT_E, type: 'song', song_stage: null });
    expect(db.tables.track_links.find((l) => l.to_track_id === track.id)).toMatchObject({ from_track_id: S3, relation: 'version', user_id: null });
    // Recorded, as coming from a project member.
    expect(events('recording.uploaded')).toHaveLength(1);
    expect(events('recording.uploaded')[0]).toMatchObject({ org_id: L, actor_id: EXT_E, project_id: LP2, payload: { relation: 'version', by: 'project_member' } });
  });

  it('an ORG member uploading to the same song still lands in every project of it (unchanged)', async () => {
    const res = await upload(OWN, version());
    expect(res.status).toBe(200);
    expect((await res.json()).track.projectIds.sort()).toEqual([LP2, LP3].sort());
  });

  it.each([
    ['a viewer', EXT_V, version(), 403],
    ['a new song for an artist (no artist scope)', EXT_E, song(C1), 404],
    ['master material', EXT_E, link('master', S3), 403],
    ['instrumental material', EXT_E, link('instrumental', S3), 403],
    ['a demo', EXT_E, link('demo', S3), 403],
    ['a song in the same org that is not in their project', EXT_E, version(S1), 404],
    ['a song of another org', EXT_E, version(XS1), 404],
    ['an editor of the OTHER project on this song is fine (control)', EXT_E2, version(), 200],
    ['a stranger', STRANGER, version(), 404],
  ] as const)('init: %s → %i', async (_label, who, intent, statusCode) => {
    const res = await call('init', who, L, { ...file('v2.wav'), as: intent as unknown as Body });
    expect(res.status).toBe(statusCode);
    if (statusCode !== 200) expect(storage.inits).toEqual([]);
  });

  it('not through another org’s path either', async () => {
    expect((await call('init', EXT_E, L2, { ...file('v2.wav'), as: version() })).status).toBe(404);
  });

  it('the gate is checked again at complete: removed in between → nothing is finalised or written', async () => {
    const { sessionId } = await (await call('init', EXT_E, L, { ...file('v2.wav'), as: version() })).json();
    db.tables.project_members = db.tables.project_members.filter((m) => m.user_id !== EXT_E);
    const done = await call('complete', EXT_E, L, { sessionId, as: version() });
    expect(done.status).toBe(404);
    expect(db.tables.tracks.filter((t) => t.created_by === EXT_E)).toEqual([]);
    expect(storage.enqueued).toEqual([]);
  });

  it('demoted to a viewer in between: refused at complete', async () => {
    const { sessionId } = await (await call('init', EXT_E, L, { ...file('v2.wav'), as: version() })).json();
    db.tables.project_members.find((m) => m.user_id === EXT_E)!.role = 'viewer';
    expect((await call('complete', EXT_E, L, { sessionId, as: version() })).status).toBe(403);
    expect(db.tables.tracks.filter((t) => t.created_by === EXT_E)).toEqual([]);
  });

  it('a session belongs to its starter: another external member (or the owner) cannot sign, finish or abort it', async () => {
    const { sessionId } = await (await call('init', EXT_E, L, { ...file('v2.wav'), as: version() })).json();
    expect((await call('part', EXT_E2, L, { sessionId, partNumbers: [1] })).status).toBe(404);
    expect((await call('complete', EXT_E2, L, { sessionId, as: version() })).status).toBe(404);
    expect((await call('abort', EXT_E2, L, { sessionId })).status).toBe(404);
    expect((await status(EXT_E2, L, sessionId)).status).toBe(404);
    expect((await call('abort', OWN, L, { sessionId })).status).toBe(404);
    expect((await call('abort', EXT_E, L, { sessionId })).status).toBe(200);
  });

  it('a viewer cannot reach the session routes at all', async () => {
    const { sessionId } = await (await call('init', EXT_E, L, { ...file('v2.wav'), as: version() })).json();
    expect((await call('part', EXT_V, L, { sessionId, partNumbers: [1] })).status).toBe(403);
    expect((await status(EXT_V, L, sessionId)).status).toBe(403);
    expect((await call('abort', EXT_V, L, { sessionId })).status).toBe(403);
  });

  it('an external member’s upload is still in the project when they are removed (D3)', async () => {
    const res = await upload(EXT_E, version());
    const { track } = await res.json();
    db.tables.project_members = db.tables.project_members.filter((m) => m.user_id !== EXT_E);
    expect(db.tables.tracks.find((t) => t.id === track.id)).toMatchObject({ created_by: EXT_E });
    expect(tracksOf(LP2)).toContain(track.id);
  });

  it('targets (artist-keyed) and every other org route stay closed to them', async () => {
    expect((await targets(EXT_E, L, C1)).status).toBe(404);
  });
});
