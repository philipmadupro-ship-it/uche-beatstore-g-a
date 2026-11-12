/**
 * PUT / GET /api/org/[orgId]/releases/[releaseId]/store (LABEL-42) through the
 * REAL lib/auth/org-access, lib/labelos/store-listing(+store) and activity
 * writer against an in-memory database. Only the bytes are stubbed:
 * `promotePreviews` / `deletePromotedPreviews` are spies, so the tests can say
 * exactly when a public copy is made and when one is removed.
 *
 *   P: the store owner's PRODUCER org (owner PU). L: a label org (owner OWN),
 *   A&R and marketing members. RP / RL: a release in each, with songs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const P = '10000000-0000-4000-8000-0000000000a1';
const L = '10000000-0000-4000-8000-000000000001';
const A = '10000000-0000-4000-8000-0000000000a2';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PU = u(1);
const OWN = u(2);
const MKT = u(3);
const AR = u(4);
const CP = '30000000-0000-4000-8000-0000000000c1';
const CL = '30000000-0000-4000-8000-0000000000c2';
const CA = '30000000-0000-4000-8000-0000000000c3';
const PP = '40000000-0000-4000-8000-0000000000a1';
const PL = '40000000-0000-4000-8000-0000000000a2';
const PA = '40000000-0000-4000-8000-0000000000a3';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RP = '70000000-0000-4000-8000-000000000001';
const RL = '70000000-0000-4000-8000-000000000002';
const RA = '70000000-0000-4000-8000-000000000003';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let failEvents = false;
const promote = vi.fn();
const del = vi.fn();
const derive = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (failEvents && table === 'activity_events') {
        const res = { data: null, error: { message: 'insert failed' } };
        const q: Record<string, unknown> = {};
        for (const m of ['insert', 'select']) q[m] = () => q;
        q.single = async () => res;
        q.maybeSingle = async () => res;
        return q;
      }
      return mem.client.from(table);
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/storage/store-release-media', () => ({
  promotePreviews: (...args: unknown[]) => promote(...args),
  deletePromotedPreviews: (...args: unknown[]) => del(...args),
}));

vi.mock('@/lib/storage/org-derivative', () => ({
  ensureFullDerivative: (...args: unknown[]) => derive(...args),
}));

const member = (user: string, role: string, functions: string[] = [], org = L) => ({
  org_id: org, user_id: user, role, functions, scope: 'org', cap_grants: [], cap_revokes: [],
});
const release = (id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: org, project_id: project, contact_id: contact, title: 'Night Shift', type: 'album', upc: null, label_name: null, c_line: null,
  p_line: null, primary_genre: null, target_date: null, release_date: '2024-02-02', artwork_asset_id: null, state: 'delivered',
  delivered_at: '2024-02-02T12:00:00Z', delivered_to: 'X', imported_released: false, store_listed: false, store_listed_at: null,
  store_playback: 'preview', created_by: PU, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
});
const item = (id: string, rel: string, org: string, n: number, song: string) => ({
  id, release_id: rel, org_id: org, position: n, song_track_id: song, master_track_id: song, version_title: null, explicit: false,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  failEvents = false;
  promote.mockReset().mockImplementation(async (_o: string, _r: string, items: { masterTrackId: string; privatePreviewRef: string | null }[]) =>
    items.filter((i) => i.privatePreviewRef).map((i) => i.masterTrackId));
  del.mockReset().mockResolvedValue(1);
  derive.mockReset().mockResolvedValue(true);
  db = {
    tables: {
      creator_profiles: [{ user_id: PU, display_name: 'Uche', default_artwork_url: null }],
      organizations: [
        { id: P, kind: 'producer', deleted_at: null, settings: {}, created_at: '2026-01-01T00:00:00Z' },
        { id: L, kind: 'label', deleted_at: null, settings: {}, created_at: '2026-01-02T00:00:00Z' },
        { id: A, kind: 'artist', deleted_at: null, settings: {}, created_at: '2026-01-03T00:00:00Z' },
      ],
      org_members: [member(PU, 'owner', [], P), member(OWN, 'owner', [], L), member(MKT, 'member', ['marketing'], P), { ...member(AR, 'member', [], P), cap_grants: ['catalog.read', 'catalog.write', 'release.write'] }],
      org_connections: [],
      track_links: [],
      song_beats: [],
      contacts: [
        { id: CP, org_id: P, user_id: null, name: 'Nova', category: 'artist' },
        { id: CL, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CA, org_id: A, user_id: null, name: 'Ari', category: 'artist' },
      ],
      projects: [
        { id: PP, org_id: P, user_id: null, name: 'Night Shift', inbox_for_contact_id: null },
        { id: PL, org_id: L, user_id: null, name: 'Kilo EP', inbox_for_contact_id: null },
        { id: PA, org_id: A, user_id: null, name: 'Ari EP', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: PP, contact_id: CP, user_id: PU }],
      tracks: [
        { id: t(1), org_id: P, user_id: null, title: 'One', type: 'song', song_stage: 'selected', audio_url: 'r2://priv/orgs/p/tracks/1.wav', preview_url: 'r2://priv/orgs/p/previews/1.mp3', duration_seconds: 100 },
        { id: t(2), org_id: P, user_id: null, title: 'Two', type: 'song', song_stage: 'selected', audio_url: 'r2://priv/orgs/p/tracks/2.wav', preview_url: null, duration_seconds: 90 },
        { id: t(3), org_id: L, user_id: null, title: 'Three', type: 'song', song_stage: 'selected', audio_url: 'r2://priv/orgs/l/tracks/3.wav', preview_url: null, duration_seconds: 90 },
        { id: t(4), org_id: A, user_id: null, title: 'Four', type: 'song', song_stage: 'selected', audio_url: 'r2://priv/orgs/a/tracks/4.wav', preview_url: null, duration_seconds: 90 },
      ],
      releases: [release(RP, P, PP, CP), release(RL, L, PL, CL), release(RA, A, PA, CA)],
      release_items: [item('80000000-0000-4000-8000-000000000001', RP, P, 1, t(1)), item('80000000-0000-4000-8000-000000000002', RP, P, 2, t(2)), item('80000000-0000-4000-8000-000000000003', RL, L, 1, t(3)), item('80000000-0000-4000-8000-000000000004', RA, A, 1, t(4))],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(method: 'GET' | 'PUT', as: string | null, org: string, id: string, body?: unknown) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/releases/${id}/store`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return mod[method](req, { params: Promise.resolve({ orgId: org, releaseId: id }) });
}
const put = (as: string | null, org: string, id: string, body: unknown) => call('PUT', as, org, id, body);
const row = (id: string) => db.tables.releases.find((r) => r.id === id)!;
const events = (verb: string) => db.tables.activity_events.filter((e) => e.verb === verb);

describe('putting a release on the store', () => {
  it('lists a delivered release of the store owner’s studio: promotes the previews, records an audit event', async () => {
    const res = await put(PU, P, RP, { listed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ listed: true, playback: 'preview', promoted: 1 });
    expect(row(RP)).toMatchObject({ store_listed: true, store_playback: 'preview' });
    expect(row(RP).store_listed_at).toBeTruthy();
    expect(promote).toHaveBeenCalledTimes(1);
    expect(events('release.store_listed')).toHaveLength(1);
    expect(events('release.store_listed')[0]).toMatchObject({ org_id: P, actor_id: PU, release_id: RP, audit: true, visibility: 'artist' });
  });

  it('an unreleased (draft) release is 409: nothing promoted, written or recorded', async () => {
    Object.assign(row(RP), { state: 'draft', delivered_at: null });
    const res = await put(PU, P, RP, { listed: true });
    expect(res.status).toBe(409);
    expect(row(RP).store_listed).toBe(false);
    expect(promote).not.toHaveBeenCalled();
    expect(events('release.store_listed')).toHaveLength(0);
  });

  it('a delivered release whose street date has not come lists as a TEASER: previews only, never full (LABEL-72)', async () => {
    row(RP).release_date = '2999-01-01';
    const res = await put(PU, P, RP, { listed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ listed: true, playback: 'preview', effectivePlayback: 'preview' });
    expect(promote).toHaveBeenCalledTimes(1);
    expect(derive).not.toHaveBeenCalled();
    expect(row(RP)).toMatchObject({ store_listed: true, store_playback: 'preview' });
  });

  it('choosing full songs before the release date is 409 (field playback): nothing is cut, copied or written', async () => {
    for (const release_date of ['2999-01-01', null]) {
      row(RP).release_date = release_date;
      const res = await put(PU, P, RP, { listed: true, playback: 'full' });
      expect(res.status).toBe(409);
      expect((await res.json()).field).toBe('playback');
    }
    expect(derive).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
    expect(row(RP).store_listed).toBe(false);
    expect(events('release.store_listed')).toHaveLength(0);
  });

  it('the GET says whether full songs can be chosen yet, and what visitors hear now', async () => {
    row(RP).release_date = '2999-01-01';
    expect(await (await call('GET', PU, P, RP)).json()).toMatchObject({ fullAvailable: false, effectivePlayback: 'preview', releaseDate: '2999-01-01' });
    row(RP).release_date = '2024-02-02';
    row(RP).store_playback = 'full';
    expect(await (await call('GET', PU, P, RP)).json()).toMatchObject({ fullAvailable: true, effectivePlayback: 'full', playback: 'full' });
    // The date is stated later than it was read: the stored choice stays, what is heard is derived.
    row(RP).release_date = '2999-01-01';
    expect(await (await call('GET', PU, P, RP)).json()).toMatchObject({ fullAvailable: false, effectivePlayback: 'preview', playback: 'full' });
  });

  it('an imported already-released album lists without a delivery', async () => {
    Object.assign(row(RP), { state: 'delivered', imported_released: true });
    expect((await put(PU, P, RP, { listed: true })).status).toBe(200);
  });

  it('a cancelled release is 409', async () => {
    row(RP).state = 'cancelled';
    expect((await put(PU, P, RP, { listed: true })).status).toBe(409);
  });

  it('a label-owned release is 409 on org (label stores are a later phase), an unconnected artist org too', async () => {
    const res = await put(OWN, L, RL, { listed: true });
    expect(res.status).toBe(409);
    expect((await res.json()).field).toBe('org');
    expect(row(RL).store_listed).toBe(false);
    expect(promote).not.toHaveBeenCalled();
  });

  it('an artist org with an ACTIVE connection to a label the store owner owns may list', async () => {
    db.tables.org_members.push(member(PU, 'owner', [], L), member(PU, 'owner', [], A));
    db.tables.org_connections.push({ id: 'k1', label_org_id: L, artist_org_id: A, status: 'active' });
    expect((await put(PU, A, RA, { listed: true })).status).toBe(200);
    // ... and an ended one may not.
    db.tables.org_connections[0].status = 'ended';
    row(RA).store_listed = false;
    expect((await put(PU, A, RA, { listed: true })).status).toBe(409);
  });

  it('a release with no songs is 409', async () => {
    db.tables.release_items = db.tables.release_items.filter((i) => i.release_id !== RP);
    expect((await put(PU, P, RP, { listed: true })).status).toBe(409);
  });

  it('preview mode with no clip ready yet (R2 on) is 409, not an empty listing', async () => {
    promote.mockResolvedValue([]);
    process.env.R2_ACCOUNT_ID = 'test-account-id';
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_BUCKET_NAME = 'pub';
    process.env.R2_PRIVATE_BUCKET_NAME = 'priv';
    try {
      const res = await put(PU, P, RP, { listed: true });
      expect(res.status).toBe(409);
      expect(row(RP).store_listed).toBe(false);
    } finally {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PRIVATE_BUCKET_NAME']) delete process.env[k];
    }
  });

  it('full playback is stored, cuts a private derivative of each master and copies nothing to the public bucket', async () => {
    const res = await put(PU, P, RP, { listed: true, playback: 'full' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ playback: 'full', effectivePlayback: 'full', promoted: 0 });
    expect(row(RP).store_playback).toBe('full');
    expect(promote).not.toHaveBeenCalled();
    expect(derive.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      [P, t(1), 'r2://priv/orgs/p/tracks/1.wav'],
      [P, t(2), 'r2://priv/orgs/p/tracks/2.wav'],
    ]);
    expect(events('release.store_listed')[0].payload).toMatchObject({ playback: 'full', effectivePlayback: 'full', promoted: 0, derivatives: 2 });
  });

  it('full is all or nothing: a master that cannot be cut is named, and nothing is listed or recorded', async () => {
    derive.mockImplementation(async (_o: string, track: string) => track !== t(2));
    const res = await put(PU, P, RP, { listed: true, playback: 'full' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('Two');
    expect(body.error).not.toContain('One');
    expect(row(RP)).toMatchObject({ store_listed: false, store_playback: 'preview' });
    expect(events('release.store_listed')).toHaveLength(0);
  });

  it('re-listing a stored full whose date has not come plays as preview: previews are promoted, no derivative is cut', async () => {
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-01T00:00:00Z', store_playback: 'full', release_date: '2999-01-01' });
    const res = await put(PU, P, RP, { listed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ playback: 'full', effectivePlayback: 'preview' });
    expect(row(RP).store_playback).toBe('full');
    expect(promote).toHaveBeenCalledTimes(1);
    expect(derive).not.toHaveBeenCalled();
  });

  it('a member without release.write is 403, a stranger 404, signed out 401', async () => {
    expect((await put(MKT, P, RP, { listed: true })).status).toBe(403);
    expect((await put(OWN, P, RP, { listed: true })).status).toBe(404);
    expect((await put(null, P, RP, { listed: true })).status).toBe(401);
    expect(row(RP).store_listed).toBe(false);
    expect(events('release.store_listed')).toHaveLength(0);
  });

  it('a bad body is 400', async () => {
    for (const body of [{}, { listed: 'yes' }, { listed: true, playback: 'loud' }, { listed: true, delete_previews: true }]) {
      expect((await put(PU, P, RP, body)).status).toBe(400);
    }
  });

  it('a listing whose audit event cannot be written does not stand', async () => {
    failEvents = true;
    const res = await put(PU, P, RP, { listed: true });
    expect(res.status).toBe(500);
    expect(row(RP).store_listed).toBe(false);
    expect(del).toHaveBeenCalled();
  });
});

describe('review fixes (LABEL-42)', () => {
  it('an IMPORTED release is the owner’s or an admin’s: A&R cannot list, change playback or unlist it', async () => {
    Object.assign(row(RP), { imported_released: true });
    for (const body of [{ listed: true }, { listed: true, playback: 'full' }, { listed: false }]) {
      expect((await put(AR, P, RP, body)).status).toBe(403);
    }
    expect(row(RP).store_listed).toBe(false);
    expect(promote).not.toHaveBeenCalled();
    expect(events('release.store_listed')).toHaveLength(0);
    db.tables.org_members.find((m) => m.user_id === AR)!.role = 'admin';
    expect((await put(AR, P, RP, { listed: true })).status).toBe(200);
  });

  it('a recording that is a demo (working music) blocks the listing and is named — nothing is promoted', async () => {
    db.tables.tracks[1].song_stage = 'in_review';
    const res = await put(PU, P, RP, { listed: true, playback: 'full' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.field).toBe('items');
    expect(body.error).toContain('Two');
    expect(row(RP).store_listed).toBe(false);
    expect(promote).not.toHaveBeenCalled();
  });

  it('a master the song vouches for is finished, however its own stage reads', async () => {
    db.tables.tracks[1].song_stage = 'in_review';
    db.tables.tracks.push({ id: t(9), org_id: P, user_id: null, title: 'Two (master)', type: 'song', song_stage: null, audio_url: 'r2://priv/orgs/p/tracks/9.wav', preview_url: null, duration_seconds: 90 });
    db.tables.track_links.push({ from_track_id: t(2), to_track_id: t(9), relation: 'master' });
    db.tables.release_items.find((i) => i.id === '80000000-0000-4000-8000-000000000002')!.master_track_id = t(9);
    expect((await put(PU, P, RP, { listed: true, playback: 'full' })).status).toBe(200);
  });

  it('preview mode lists only when EVERY item is promoted (R2 on), and names the missing one', async () => {
    process.env.R2_ACCOUNT_ID = 'test-account-id';
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_BUCKET_NAME = 'pub';
    process.env.R2_PRIVATE_BUCKET_NAME = 'priv';
    try {
      // Item 1 has a clip, item 2 has none: the default mock promotes only item 1.
      const res = await put(PU, P, RP, { listed: true });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain('Two');
      expect(row(RP).store_listed).toBe(false);
      expect(del).toHaveBeenCalled(); // the half-promoted copies do not stay behind
    } finally {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PRIVATE_BUCKET_NAME']) delete process.env[k];
    }
  });

  it('the write itself repeats what was judged: a release that stopped being released is not listed', async () => {
    // The state changes between the plan and the update: the guarded UPDATE matches no row.
    const real = mem.client.from.bind(mem.client);
    let first = true;
    vi.spyOn(mem.client, 'from').mockImplementation(((table: string) => {
      const q = real(table);
      if (table === 'releases' && !first) return q;
      if (table === 'releases') {
        first = false;
        // The first read of the release is untouched; flip the date once it has been read.
        return q;
      }
      if (table === 'release_items') row(RP).release_date = '2999-01-01';
      return q;
    }) as typeof mem.client.from);
    const res = await put(PU, P, RP, { listed: true, playback: 'full' });
    vi.restoreAllMocks();
    expect(res.status).toBe(409);
    expect(row(RP).store_listed).toBe(false);
    expect(events('release.store_listed')).toHaveLength(0);
  });

  it('when the listing cannot be recorded AND cannot be undone, it says so (500, listed: true) rather than pretending', async () => {
    const real = mem.client.from.bind(mem.client);
    let updates = 0;
    vi.spyOn(mem.client, 'from').mockImplementation(((table: string) => {
      if (table === 'activity_events') {
        const res = { data: null, error: { message: 'insert failed' } };
        const q: Record<string, unknown> = {};
        for (const m of ['insert', 'select']) q[m] = () => q;
        q.single = async () => res;
        q.maybeSingle = async () => res;
        return q;
      }
      const q = real(table) as Record<string, unknown>;
      if (table === 'releases') {
        const update = q.update as (...a: unknown[]) => unknown;
        q.update = (...a: unknown[]) => {
          updates += 1;
          if (updates < 2) return update(...a);
          const res = { data: null, error: { message: 'revert failed' } };
          const f: Record<string, unknown> = {};
          for (const m of ['eq', 'is', 'select']) f[m] = () => f;
          f.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
          return f;
        };
      }
      return q;
    }) as typeof mem.client.from);
    const res = await put(PU, P, RP, { listed: true, playback: 'full' });
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    expect((await res.json()).listed).toBe(true);
  });

  it('never deletes previews of music that was listed while released, even if the date later reads as future', async () => {
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z', release_date: '2999-01-01', imported_released: false });
    // Listed on 2026-10-10 with a date in 2999 is the "never out" shape: the owner is asked.
    const res = await put(PU, P, RP, { listed: false, delete_previews: true });
    expect((await res.json()).previewsDeleted).toBe(true);
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z', release_date: '2026-10-01' });
    del.mockClear();
    const kept = await put(PU, P, RP, { listed: false, delete_previews: true });
    expect((await kept.json()).previewsDeleted).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('taking a release off the store', () => {
  beforeEach(() => {
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
  });

  it('unlists and records an audit event', async () => {
    const res = await put(PU, P, RP, { listed: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ listed: false, previewsDeleted: false });
    expect(row(RP)).toMatchObject({ store_listed: false, store_listed_at: null });
    expect(events('release.store_unlisted')).toHaveLength(1);
    expect(events('release.store_unlisted')[0]).toMatchObject({ audit: true, visibility: 'artist' });
  });

  it('music that was publicly out keeps its previews, however the owner answers', async () => {
    const res = await put(PU, P, RP, { listed: false, delete_previews: true });
    expect(res.status).toBe(200);
    expect(del).not.toHaveBeenCalled();
    expect(events('release.store_unlisted')[0].payload).toMatchObject({ deletePreviews: false, askedToDeletePreviews: false });
  });

  it('never publicly out (date moved to the future): deleted only when the owner said yes', async () => {
    row(RP).release_date = '2999-01-01';
    expect((await put(PU, P, RP, { listed: false, delete_previews: false })).status).toBe(200);
    expect(del).not.toHaveBeenCalled();
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
    const res = await put(PU, P, RP, { listed: false, delete_previews: true });
    expect(await res.json()).toMatchObject({ previewsDeleted: true });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('a release that is not listed is 409 and records nothing', async () => {
    row(RP).store_listed = false;
    expect((await put(PU, P, RP, { listed: false })).status).toBe(409);
    expect(events('release.store_unlisted')).toHaveLength(0);
  });

  it('an unlist whose audit event cannot be written is put back', async () => {
    failEvents = true;
    expect((await put(PU, P, RP, { listed: false })).status).toBe(500);
    expect(row(RP).store_listed).toBe(true);
  });
});

describe('the store state (GET)', () => {
  it('says what listing would do, and nothing about storage', async () => {
    const res = await call('GET', PU, P, RP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ listed: false, playback: 'preview', canList: { ok: true }, unlist: { askToDeletePreviews: false } });
    expect(JSON.stringify(body)).not.toMatch(/r2:\/\/|audio_url|preview_url/);
  });
  it('explains a refusal in its own words', async () => {
    row(RP).state = 'draft';
    const body = await (await call('GET', PU, P, RP)).json();
    expect(body.canList).toMatchObject({ ok: false, field: 'state' });
  });
  it('a stranger is 404', async () => {
    expect((await call('GET', OWN, P, RP)).status).toBe(404);
  });
});

describe('re-review fixes (LABEL-42)', () => {
  it('a delivery with only a FUTURE target date and no release date can be a teaser, never full', async () => {
    Object.assign(row(RP), { release_date: null, target_date: '2999-01-01' });
    const full = await put(PU, P, RP, { listed: true, playback: 'full' });
    expect(full.status).toBe(409);
    expect((await full.json()).error).toMatch(/from the release date/);
    expect(row(RP).store_listed).toBe(false);
    expect(events('release.store_listed')).toHaveLength(0);
    expect((await put(PU, P, RP, { listed: true })).status).toBe(200);
    expect(row(RP)).toMatchObject({ store_listed: true, store_playback: 'preview' });
  });

  it('choosing full songs is the owner’s or an admin’s: A&R gets 403 and nothing is written; preview is theirs', async () => {
    const full = await put(AR, P, RP, { listed: true, playback: 'full' });
    expect(full.status).toBe(403);
    expect((await full.json()).field).toBe('playback');
    expect(row(RP).store_listed).toBe(false);
    expect((await put(AR, P, RP, { listed: true })).status).toBe(200);
    expect(row(RP).store_playback).toBe('preview');
  });

  it('an unlist whose record cannot be written AND whose put-back fails says the release is off the store, and that retrying is safe', async () => {
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
    const real = mem.client.from.bind(mem.client);
    let updates = 0;
    vi.spyOn(mem.client, 'from').mockImplementation(((table: string) => {
      if (table === 'activity_events') {
        const res = { data: null, error: { message: 'insert failed' } };
        const q: Record<string, unknown> = {};
        for (const m of ['insert', 'select']) q[m] = () => q;
        q.single = async () => res;
        q.maybeSingle = async () => res;
        return q;
      }
      const q = real(table) as Record<string, unknown>;
      if (table === 'releases') {
        const update = q.update as (...a: unknown[]) => unknown;
        q.update = (...a: unknown[]) => {
          updates += 1;
          if (updates < 2) return update(...a);
          const res = { data: null, error: { message: 'revert failed' } };
          const f: Record<string, unknown> = {};
          for (const m of ['eq', 'is', 'select']) f[m] = () => f;
          f.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
          return f;
        };
      }
      return q;
    }) as typeof mem.client.from);
    const res = await put(PU, P, RP, { listed: false });
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.listed).toBe(false);
    expect(body.error).toMatch(/off the store/);
    expect(body.error).toMatch(/safe/);
    expect(row(RP).store_listed).toBe(false);
  });
});

describe('round 3 (LABEL-42)', () => {
  it('unlisting puts playback back to preview: a later listing by A&R does not inherit an owner’s full', async () => {
    expect((await put(PU, P, RP, { listed: true, playback: 'full' })).status).toBe(200);
    expect(row(RP).store_playback).toBe('full');
    expect((await put(PU, P, RP, { listed: false })).status).toBe(200);
    expect(row(RP).store_playback).toBe('preview');
    expect((await put(AR, P, RP, { listed: true })).status).toBe(200);
    expect(row(RP).store_playback).toBe('preview');
  });

  it('a listing that loses the race after previews were promoted removes them again when the music is not publicly out', async () => {
    promote.mockImplementation(async (_o: string, _r: string, items: { masterTrackId: string; privatePreviewRef: string | null }[]) => {
      // The release is cancelled while the previews are being copied.
      row(RP).state = 'cancelled';
      return items.filter((i) => i.privatePreviewRef).map((i) => i.masterTrackId);
    });
    const res = await put(PU, P, RP, { listed: true });
    expect(res.status).toBe(409);
    expect(row(RP).store_listed).toBe(false);
    expect(del).toHaveBeenCalledTimes(1);
    expect(events('release.store_listed')).toHaveLength(0);
  });
});

describe('the store module withdrawn (LABEL-47)', () => {
  const withdraw = () => {
    db.tables.org_entitlements = [{ org_id: P, modules: ['contracts', 'export'], max_seats: null, max_artists: null, setup_done: true }];
  };

  it('listing is 404, as if the route did not exist: nothing written, promoted or recorded', async () => {
    withdraw();
    expect((await put(PU, P, RP, { listed: true })).status).toBe(404);
    expect((await call('GET', PU, P, RP)).status).toBe(404);
    expect(row(RP).store_listed).toBe(false);
    expect(promote).not.toHaveBeenCalled();
    expect(events('release.store_listed')).toHaveLength(0);
  });

  it('a release listed before the withdrawal can still be read and taken off (200, audited)', async () => {
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
    withdraw();
    expect((await call('GET', PU, P, RP)).status).toBe(200);
    // Changing the listing (here, its playback) still needs the module.
    expect((await put(PU, P, RP, { listed: true, playback: 'full' })).status).toBe(404);
    const res = await put(PU, P, RP, { listed: false });
    expect(res.status).toBe(200);
    expect(row(RP)).toMatchObject({ store_listed: false, store_listed_at: null });
    expect(events('release.store_unlisted')).toHaveLength(1);
  });

  it('another org keeps its own licence: the withdrawal there changes nothing here', async () => {
    db.tables.org_entitlements = [{ org_id: L, modules: [], max_seats: null, max_artists: null, setup_done: true }];
    expect((await put(PU, P, RP, { listed: true })).status).toBe(200);
  });
});
