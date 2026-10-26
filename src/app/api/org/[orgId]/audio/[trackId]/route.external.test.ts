/**
 * GET /api/org/[orgId]/audio/[trackId] for an EXTERNAL project member
 * (LABEL-21, 06 §2.6): the recordings of THEIR project and nothing else;
 * listening vs downloading per role; every handed-over file audited
 * (`recording.downloaded`, written BEFORE the first byte); revocation on the
 * next request. The org-member matrix is route.test.ts, unchanged.
 *
 *   L (label): project P1 (Uche × Producer X) with the song S1 and S1V (a
 *   version); project P2 (not shared) with S2; a track in no project;
 *   L2: one project with one track. Producer catalogue: one track.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VIEWER = u(1);
const COMMENTER = u(2);
const CONTRIBUTOR = u(3);
const EDITOR = u(4);
const STRANGER = u(5);
const OTHER_ORG_MEMBER = u(6);
const P1 = '40000000-0000-4000-8000-0000000000a1';
const P2 = '40000000-0000-4000-8000-0000000000a2';
const XP = '40000000-0000-4000-8000-0000000000b1';
const k = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = { s1: k(1), s1v: k(2), s2: k(3), loose: k(4), other: k(5), producer: k(6), both: k(7) } as const;

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let auditFails = false;
const r2Gets: { key: string; range: string | null }[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/storage/upload', () => {
  const parse = (value: string) => {
    if (!value.startsWith('r2://')) return null;
    const rest = value.slice(5);
    const slash = rest.indexOf('/');
    return slash > 0 ? { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) } : null;
  };
  return {
    parseR2ObjectRef: parse,
    getStoredObject: async (source: string, range?: string | null) => {
      const ref = parse(source);
      if (!ref) return null;
      r2Gets.push({ key: ref.key, range: range ?? null });
      const full = new TextEncoder().encode(`BYTES:${ref.key}`.padEnd(100, '.'));
      return {
        Body: { transformToWebStream: () => new Blob([full]).stream() },
        ContentType: ref.key.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
        AcceptRanges: 'bytes',
        ContentLength: full.length,
      };
    },
  };
});

const pm = (user: string, role: string, project = P1, org = L, extra: Record<string, unknown> = {}) => ({
  org_id: org, project_id: project, user_id: user, role, allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01', ...extra,
});
const track = (id: string, org: string | null, extra: Record<string, unknown> = {}) => ({
  id, org_id: org, user_id: org ? null : u(99), title: `T-${id.slice(-2)}`, type: 'song', song_stage: 'in_review',
  audio_url: `r2://priv/${id.slice(-2)}.mp3`, wav_url: `r2://priv/${id.slice(-2)}.wav`, preview_url: `r2://priv/${id.slice(-2)}.preview.mp3`, peaks_url: `r2://priv/${id.slice(-2)}.peaks.json`, ...extra,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  process.env.R2_PRIVATE_BUCKET_NAME = 'priv';
  process.env.R2_BUCKET_NAME = 'pub';
  process.env.R2_ACCOUNT_ID = 'test-account-id';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  current = null;
  auditFails = false;
  r2Gets.length = 0;
  db = {
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null },
        { id: L2, kind: 'label', deleted_at: null },
      ],
      org_members: [{ org_id: L2, user_id: OTHER_ORG_MEMBER, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] }],
      project_members: [
        pm(VIEWER, 'viewer'),
        pm(COMMENTER, 'commenter'),
        pm(CONTRIBUTOR, 'contributor'),
        pm(EDITOR, 'editor'),
      ],
      projects: [
        { id: P1, org_id: L, user_id: null, name: 'Uche × Producer X' },
        { id: P2, org_id: L, user_id: null, name: 'Secret LP' },
        { id: XP, org_id: L2, user_id: null, name: 'Elsewhere' },
      ],
      project_tracks: [
        { project_id: P1, track_id: T.s1, position: 0 },
        { project_id: P1, track_id: T.s1v, position: 1 },
        { project_id: P2, track_id: T.s2, position: 0 },
        { project_id: XP, track_id: T.other, position: 0 },
        { project_id: P1, track_id: T.both, position: 2 },
        { project_id: P2, track_id: T.both, position: 1 },
      ],
      tracks: [
        track(T.s1, L),
        track(T.s1v, L, { song_stage: null }),
        track(T.s2, L),
        track(T.loose, L),
        track(T.other, L2),
        track(T.producer, null),
        track(T.both, L),
      ],
      track_links: [{ from_track_id: T.s1, to_track_id: T.s1v, relation: 'version', position: 0 }],
      song_beats: [],
      release_items: [],
      stems: [{ track_id: T.s1, status: 'done', vocals_url: 'r2://priv/stems/s1/vocals.wav', drums_url: null, bass_url: null, other_url: null }],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

async function get(as: string | null, trackId: string, query = '', org = L, method: 'GET' | 'HEAD' = 'GET') {
  current = as;
  const req = new NextRequest(`https://app.test/api/org/${org}/audio/${trackId}${query}`, { method });
  const mod = await import('./route');
  return mod[method](req, { params: Promise.resolve({ orgId: org, trackId }) });
}
const downloads = () => db.tables.activity_events.filter((e) => e.verb === 'recording.downloaded');

describe('listening: every role, the recordings of their project only', () => {
  it.each([['viewer', VIEWER], ['commenter', COMMENTER], ['contributor', CONTRIBUTOR], ['editor', EDITOR]])('%s streams the master, the preview and the peaks', async (_r, user) => {
    for (const variant of ['full', 'preview', 'peaks']) {
      const res = await get(user, T.s1, `?variant=${variant}`);
      expect(res.status, variant).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('location')).toBeNull();
    }
    expect(downloads()).toEqual([]); // listening is not audited
  });

  it('a version in their project is theirs to hear too', async () => {
    expect((await get(VIEWER, T.s1v)).status).toBe(200);
  });

  it('a track in two projects is reachable through the one they belong to', async () => {
    expect((await get(VIEWER, T.both)).status).toBe(200);
  });

  it.each([
    ['another project of the same org', T.s2],
    ['a track in no project', T.loose],
    ['another org’s track', T.other],
    ['a producer track', T.producer],
    ['a missing track', k(99)],
  ])('%s → 404, and no byte is read', async (_label, id) => {
    expect((await get(EDITOR, id)).status).toBe(404);
    expect(r2Gets).toEqual([]);
  });

  it('the right track under the wrong org in the path → 404', async () => {
    expect((await get(EDITOR, T.s1, '', L2)).status).toBe(404);
  });

  it('a stranger, a member of ANOTHER org’s project and signed-out callers are refused', async () => {
    expect((await get(STRANGER, T.s1)).status).toBe(404);
    expect((await get(OTHER_ORG_MEMBER, T.s1)).status).toBe(404);
    expect((await get(null, T.s1)).status).toBe(401);
    expect(r2Gets).toEqual([]);
  });

  it('a src or key is refused outright (a track id, never a file)', async () => {
    expect((await get(VIEWER, T.s1, '?src=r2://priv/s2.mp3')).status).toBe(400);
  });
});

describe('downloading: per role, per project setting, always audited', () => {
  const dl = ['?variant=full&download=1', '?variant=wav', '?variant=stem:vocals'];

  it.each([['viewer', VIEWER], ['commenter', COMMENTER]])('%s without allow_downloads: 403 on every way to take the file, nothing audited', async (_r, user) => {
    for (const q of dl) expect((await get(user, T.s1, q)).status, q).toBe(403);
    expect(downloads()).toEqual([]);
    expect(r2Gets).toEqual([]);
  });

  it.each([['viewer', VIEWER], ['commenter', COMMENTER]])('%s WITH allow_downloads may download', async (_r, user) => {
    db.tables.project_members.find((m) => m.user_id === user)!.allow_downloads = true;
    expect((await get(user, T.s1, '?variant=full&download=1')).status).toBe(200);
  });

  it.each([['contributor', CONTRIBUTOR], ['editor', EDITOR]])('%s always may (no allow_downloads needed)', async (_r, user) => {
    for (const q of dl) expect((await get(user, T.s1, q)).status, q).toBe(200);
  });

  it('each handed-over file is ONE audit event: who, which recording, which project, which variant, in what role', async () => {
    const res = await get(EDITOR, T.s1, '?variant=full&download=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(downloads()).toHaveLength(1);
    expect(downloads()[0]).toMatchObject({
      org_id: L,
      actor_id: EDITOR,
      verb: 'recording.downloaded',
      subject_type: 'track',
      subject_id: T.s1,
      project_id: P1,
      audit: true,
      visibility: 'internal',
      payload: { variant: 'full', role: 'editor', by: 'project_member' },
    });
    await get(EDITOR, T.s1, '?variant=wav');
    await get(EDITOR, T.s1, '?variant=stem:vocals');
    expect(downloads().map((e) => (e.payload as { variant: string }).variant)).toEqual(['full', 'wav', 'stem:vocals']);
  });

  it('the audit event comes first: if it cannot be written, no byte is served (500)', async () => {
    const orig = mem.client.from;
    mem.client.from = ((t: string) => {
      if (t !== 'activity_events') return orig(t);
      const fail = { data: null, error: { message: 'audit insert refused' } };
      const b: Record<string, unknown> = {};
      for (const key of ['insert', 'select', 'single']) b[key] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(fail).then(resolve);
      b.single = async () => fail;
      return b;
    }) as typeof mem.client.from;
    const before = r2Gets.length;
    const res = await get(EDITOR, T.s1, '?variant=full&download=1');
    expect(res.status).toBe(500);
    // The master was looked at only to name the file, and its body never reached the caller.
    expect(await res.text()).not.toContain('BYTES');
    expect(r2Gets.length).toBe(before);
  });

  it('HEAD of a download streams nothing and records nothing', async () => {
    const res = await get(EDITOR, T.s1, '?variant=full&download=1', L, 'HEAD');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(downloads()).toEqual([]);
  });

  it('a range request for a download is audited too (never fewer events)', async () => {
    current = EDITOR;
    const mod = await import('./route');
    const req = new NextRequest(`https://app.test/api/org/${L}/audio/${T.s1}?variant=full&download=1`, { headers: { range: 'bytes=0-9' } });
    await mod.GET(req, { params: Promise.resolve({ orgId: L, trackId: T.s1 }) });
    expect(downloads()).toHaveLength(1);
  });
});

describe('revocation takes effect on the next request', () => {
  it('removed → 404 on the very next stream and download', async () => {
    expect((await get(EDITOR, T.s1, '?variant=full&download=1')).status).toBe(200);
    db.tables.project_members = db.tables.project_members.filter((m) => m.user_id !== EDITOR);
    expect((await get(EDITOR, T.s1)).status).toBe(404);
    expect((await get(EDITOR, T.s1, '?variant=full&download=1')).status).toBe(404);
  });

  it('expired → 404; a role downgrade takes the download away at once', async () => {
    db.tables.project_members.find((m) => m.user_id === CONTRIBUTOR)!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await get(CONTRIBUTOR, T.s1)).status).toBe(404);
    db.tables.project_members.find((m) => m.user_id === EDITOR)!.role = 'viewer';
    expect((await get(EDITOR, T.s1)).status).toBe(200);
    expect((await get(EDITOR, T.s1, '?variant=full&download=1')).status).toBe(403);
  });

  it('a soft-deleted org ends it', async () => {
    db.tables.organizations.find((o) => o.id === L)!.deleted_at = new Date().toISOString();
    expect((await get(EDITOR, T.s1)).status).toBe(404);
  });
});
