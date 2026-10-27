/**
 * Artist consent on store listing (LABEL-71), through the REAL lib/auth/org-access, the pure
 * store-consent / store-listing rules, the activity writer and the public store routes, against an
 * in-memory database. Only the bytes are stubbed (previews, streams).
 *
 *   P: the store owner's producer org (owner PU). Artists NOVA (account AU1: a member whose party is linked
 *   to her contact) and FEAT (no account). AR lists releases (a member with release.write); STAFF is A&R
 *   scoped to Nova — not her. L: a label org owned by the store owner (also PU), connected to artist org A,
 *   whose owner AO is the artist Ari (release RA, contact CA) and whose manager MGR lists for them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { resetStoreOwnerCache } from '@/lib/labelos/store-listing-store';

const P = '10000000-0000-4000-8000-0000000000a1';
const L = '10000000-0000-4000-8000-000000000001';
const A = '10000000-0000-4000-8000-0000000000a2';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PU = u(1);
const LADMIN = u(2);
const AR = u(4);
const AU1 = u(10);
const STAFF = u(11);
const STRANGER = u(12);
const AO = u(13);
const MGR = u(14);
const WRITER = u(15);
const PA_ID = 'a0000000-0000-4000-8000-0000000000a1';
const PF = 'a0000000-0000-4000-8000-0000000000a2';
const NOVA = '30000000-0000-4000-8000-0000000000c1';
const FEAT = '30000000-0000-4000-8000-0000000000c2';
const ENG = '30000000-0000-4000-8000-0000000000c3';
const CA = '30000000-0000-4000-8000-0000000000c4';
const PP = '40000000-0000-4000-8000-0000000000a1';
const PA = '40000000-0000-4000-8000-0000000000a3';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RP = '70000000-0000-4000-8000-000000000001';
const RA = '70000000-0000-4000-8000-000000000003';
const I1 = '80000000-0000-4000-8000-000000000001';
const I2 = '80000000-0000-4000-8000-000000000002';
const IA = '80000000-0000-4000-8000-000000000004';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let failVerb: string | null = null;
let missing = new Set<string>();
let broken = new Set<string>();
const promote = vi.fn();
const del = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const real = mem.client.from(table);
      if (missing.has(table)) {
        // PostgREST: a table the schema cache does not know.
        const res = { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: 'PGRST205' } };
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'is', 'not', 'order', 'limit', 'range', 'neq']) q[m] = chain;
        q.maybeSingle = async () => res;
        q.single = async () => res;
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
        return q;
      }
      if (broken.has(table)) {
        // A real failure that is NOT "table missing": the store must fail closed on it.
        const res = { data: null, error: { message: 'connection reset', code: '08006' } };
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'is', 'not', 'order', 'limit', 'range', 'neq']) q[m] = chain;
        q.maybeSingle = async () => res;
        q.single = async () => res;
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
        return q;
      }
      if (failVerb && table === 'activity_events') {
        return {
          insert: (row: Record<string, unknown>) => {
            if (row.verb === failVerb) {
              const res = { data: null, error: { message: 'insert failed' } };
              const q: Record<string, unknown> = {};
              q.select = () => q;
              q.single = async () => res;
              q.maybeSingle = async () => res;
              return q;
            }
            return (real as unknown as { insert: (r: unknown) => unknown }).insert(row);
          },
        };
      }
      return real;
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/storage/store-release-media', () => ({
  promotePreviews: (...args: unknown[]) => promote(...args),
  deletePromotedPreviews: (...args: unknown[]) => del(...args),
  promotedPreviewRef: (r: string, m: string) => `r2://pub/store-releases/${r}/${m}`,
}));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: async () => new Response('audio', { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
}));

const member = (user: string, role: string, functions: string[] = [], org = P, extra: Record<string, unknown> = {}) => ({
  org_id: org, user_id: user, role, functions, scope: 'org', cap_grants: [], cap_revokes: [], ...extra,
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
const credit = (id: string, track: string, contact: string | null, status = 'confirmed', party: string | null = null) => ({
  id, org_id: P, track_id: track, contact_id: contact, party_id: party, status,
});

beforeEach(() => {
  resetStoreOwnerCache();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  delete process.env.R2_PRIVATE_BUCKET_NAME;
  delete process.env.R2_BUCKET_NAME;
  current = null;
  failVerb = null;
  missing = new Set();
  broken = new Set();
  promote.mockReset().mockImplementation(async (_o: string, _r: string, items: { masterTrackId: string; privatePreviewRef: string | null }[]) =>
    items.filter((i) => i.privatePreviewRef).map((i) => i.masterTrackId));
  del.mockReset().mockResolvedValue(1);
  db = {
    unique: { listing_consents: [['release_id', 'artist_contact_id']], store_listing_vetoes: [['release_id']] },
    tables: {
      creator_profiles: [{ user_id: PU, display_name: 'Uche', default_artwork_url: null }],
      organizations: [
        { id: P, kind: 'producer', name: 'Studio', deleted_at: null, settings: {}, created_at: '2026-01-01T00:00:00Z' },
        { id: L, kind: 'label', name: 'Label', deleted_at: null, settings: {}, created_at: '2026-01-02T00:00:00Z' },
        { id: A, kind: 'artist', name: 'Ari', deleted_at: null, settings: {}, created_at: '2026-01-03T00:00:00Z' },
      ],
      org_members: [
        member(PU, 'owner', [], P),
        member(PU, 'owner', [], L),
        member(LADMIN, 'admin', [], L),
        member(AO, 'owner', [], A),
        { ...member(AR, 'member', [], P), cap_grants: ['catalog.read', 'catalog.write', 'release.write'] },
        member(AU1, 'member', [], P),
        { ...member(WRITER, 'member', [], P), cap_grants: ['catalog.read', 'rights.write'] },
        { ...member(MGR, 'admin', [], A) },
        member(STAFF, 'member', ['a_and_r'], P, { scope: 'artists', cap_grants: ['catalog.read'] }),
      ],
      member_artist_scopes: [{ org_id: P, user_id: STAFF, contact_id: NOVA }],
      org_connections: [{ id: 'k1', label_org_id: L, artist_org_id: A, status: 'active' }],
      track_links: [],
      song_beats: [],
      // Nova's account confirmed this party itself (LABEL-54's stamp): only then does the link stand for her.
      parties: [{ id: PA_ID, org_id: P, kind: 'person', contact_id: NOVA, user_id: AU1, display_name: 'Nova', details_confirmed_by: AU1, details_confirmed_at: '2026-10-01T00:00:00Z' }],
      contacts: [
        { id: NOVA, org_id: P, user_id: null, name: 'Nova', category: 'artist' },
        { id: FEAT, org_id: P, user_id: null, name: 'Feat', category: 'rapper' },
        { id: ENG, org_id: P, user_id: null, name: 'Engineer', category: 'engineer' },
        { id: CA, org_id: A, user_id: null, name: 'Ari', category: 'artist' },
      ],
      projects: [
        { id: PP, org_id: P, user_id: null, name: 'Night Shift', inbox_for_contact_id: null },
        { id: PA, org_id: A, user_id: null, name: 'Ari EP', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: PP, contact_id: NOVA, user_id: PU }],
      tracks: [
        { id: t(1), org_id: P, user_id: null, title: 'One', type: 'song', song_stage: 'selected', audio_url: 'r2://priv/orgs/p/tracks/1.wav', preview_url: 'r2://priv/orgs/p/previews/1.mp3', duration_seconds: 100 },
        { id: t(2), org_id: P, user_id: null, title: 'Two', type: 'song', song_stage: 'selected', audio_url: 'r2://priv/orgs/p/tracks/2.wav', preview_url: 'r2://priv/orgs/p/previews/2.mp3', duration_seconds: 90 },
        { id: t(4), org_id: A, user_id: null, title: 'Four', type: 'song', song_stage: 'selected', audio_url: 'r2://priv/orgs/a/tracks/4.wav', preview_url: 'r2://priv/orgs/a/previews/4.mp3', duration_seconds: 90 },
      ],
      track_collaborators: [
        credit('c1', t(1), FEAT),
        credit('c2', t(2), ENG),
        credit('c3', t(2), NOVA),
        credit('c4', t(1), FEAT, 'proposed'),
      ],
      releases: [release(RP, P, PP, NOVA), release(RA, A, PA, CA)],
      release_items: [item(I1, RP, P, 1, t(1)), item(I2, RP, P, 2, t(2)), item(IA, RA, A, 1, t(4))],
      activity_events: [],
      notifications: [],
      listing_consents: [],
      store_listing_vetoes: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const loaders: Record<string, () => Promise<Record<string, Handler>>> = {
  store: () => import('./route') as unknown as Promise<Record<string, Handler>>,
  consent: () => import('../consent/route') as unknown as Promise<Record<string, Handler>>,
  consents: () => import('../../../consents/route') as unknown as Promise<Record<string, Handler>>,
  connected: () => import('../../../connected-releases/route') as unknown as Promise<Record<string, Handler>>,
  veto: () => import('../../../connected-releases/[releaseId]/route') as unknown as Promise<Record<string, Handler>>,
  parties: () => import('../../../parties/route') as unknown as Promise<Record<string, Handler>>,
  party: () => import('../../../parties/[partyId]/route') as unknown as Promise<Record<string, Handler>>,
  publicDetail: () => import('@/app/api/store/releases/[id]/route') as unknown as Promise<Record<string, Handler>>,
  publicList: () => import('@/app/api/store/releases/route') as unknown as Promise<Record<string, Handler>>,
  publicAudio: () => import('@/app/api/store/releases/[id]/audio/[itemId]/route') as unknown as Promise<Record<string, Handler>>,
};

async function call(route: keyof typeof loaders, method: string, as: string | null, params: Record<string, string>, body?: unknown) {
  current = as;
  const mod = await loaders[route]();
  const req = new NextRequest('https://app.test/api/x', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return mod[method](req, { params: Promise.resolve(params) });
}
const list = (as: string | null, org: string, id: string, body: unknown) => call('store', 'PUT', as, { orgId: org, releaseId: id }, body);
const decide = (as: string | null, org: string, id: string, decision: unknown) => call('consent', 'PUT', as, { orgId: org, releaseId: id }, { decision });
const row = (id: string) => db.tables.releases.find((r) => r.id === id)!;
const events = (verb: string) => db.tables.activity_events.filter((e) => e.verb === verb);
const consentOf = (release: string, contact: string) => db.tables.listing_consents.find((c) => c.release_id === release && c.artist_contact_id === contact);
const publicDetail = (id: string) => call('publicDetail', 'GET', null, { id });
const publicAudio = (id: string, item: string) => call('publicAudio', 'GET', null, { id, itemId: item });
const publicList = async () => ((await (await call('publicList', 'GET', null, {})).json()) as { releases: { id: string }[] }).releases.map((r) => r.id);

describe('listing asks the credited artists', () => {
  it('asks the release’s artist and the confirmed roster credits — not a proposed credit, not an engineer — and tells the account that stands for each', async () => {
    const res = await list(AR, P, RP, { listed: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(row(RP).store_listed).toBe(true);
    // Nova (release artist, also credited), Feat (confirmed credit on song 1). The engineer is no artist.
    expect(db.tables.listing_consents.map((c) => [c.artist_contact_id, c.state]).sort()).toEqual([[FEAT, 'proposed'], [NOVA, 'proposed']].sort());
    // Only Nova has an account (AU1, role artist, scoped to her). Feat has nobody: counted, not invented. STAFF is scoped to Nova but is not her.
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ user_id: AU1, org_id: P, kind: 'listing_proposed', body: 'Night Shift' });
    expect(JSON.stringify(db.tables.notifications[0])).not.toMatch(/@|token|password/);
    expect(body.consent).toMatchObject({ schemaReady: true, asked: 2, notified: 1, unreachable: 1, status: 'waiting' });
    expect(events('release.store_listed')[0].payload).toMatchObject({ consentAsked: 2, consentUnreachable: 1 });
  });

  it('never notifies the asker, even when the asker is the artist’s account', async () => {
    db.tables.org_members.find((m) => m.user_id === AU1)!.cap_grants = ['catalog.read', 'catalog.write', 'release.write'];
    const res = await list(AU1, P, RP, { listed: true });
    expect(res.status).toBe(200);
    expect(db.tables.notifications).toHaveLength(0);
    expect((await res.json()).consent).toMatchObject({ asked: 2, notified: 0, unreachable: 1 });
  });

  it('an artist org’s release asks its artist — the org’s owner — when a manager lists it; the owner listing it themselves asks nobody', async () => {
    db.tables.org_members.find((m) => m.user_id === MGR)!.cap_grants = ['catalog.read', 'release.write'];
    const res = await list(MGR, A, RA, { listed: true });
    expect(res.status).toBe(200);
    expect(db.tables.listing_consents.map((c) => [c.org_id, c.artist_contact_id, c.state])).toEqual([[A, CA, 'proposed']]);
    expect(db.tables.notifications).toEqual([expect.objectContaining({ user_id: AO, org_id: A, kind: 'listing_proposed' })]);
    // The manager is not the artist.
    expect((await decide(MGR, A, RA, 'yes')).status).toBe(404);
    // The artist says no: the release comes off the store, in the artist org.
    const no = await decide(AO, A, RA, 'no');
    expect(no.status).toBe(200);
    expect(row(RA)).toMatchObject({ store_listed: false, store_playback: 'preview' });
    expect(events('listing.consent_decided')[0]).toMatchObject({ org_id: A, actor_id: AO });
    // …and the owner listing it themselves later still needs their own yes first.
    expect((await list(AO, A, RA, { listed: true })).status).toBe(409);
  });

  it('a credit through a party resolves to the party’s contact', async () => {
    db.tables.parties.push({ id: 'p1', org_id: P, kind: 'person', contact_id: ENG, user_id: null, display_name: 'X' });
    db.tables.contacts.find((c) => c.id === ENG)!.category = 'topliner';
    db.tables.track_collaborators.push(credit('c5', t(1), null, 'confirmed', 'p1'));
    await list(AR, P, RP, { listed: true });
    expect(db.tables.listing_consents.map((c) => c.artist_contact_id)).toContain(ENG);
  });

  it('without migration 186 the listing is exactly what it was: no consent step, no notification, no error', async () => {
    missing = new Set(['listing_consents', 'store_listing_vetoes']);
    const res = await list(AR, P, RP, { listed: true });
    expect(res.status).toBe(200);
    expect((await res.json()).consent).toEqual({ schemaReady: false });
    expect(row(RP).store_listed).toBe(true);
    expect(db.tables.notifications).toHaveLength(0);
    expect((await publicDetail(RP)).status).toBe(200);
    expect(await publicList()).toContain(RP);
  });

  it('a failure while asking leaves the release private', async () => {
    const original = mem.client.from.bind(mem.client);
    mem = { ...mem, client: { ...mem.client, from: (tb: string) => (tb === 'listing_consents' ? (() => { throw new Error('boom'); })() : original(tb)) } } as typeof mem;
    const res = await list(AR, P, RP, { listed: true });
    expect(res.status).toBe(500);
    expect(row(RP).store_listed).toBe(false);
    expect(db.tables.notifications).toHaveLength(0);
  });

  it('an artist’s no that lands between the check and the claim is honoured: nothing goes live, the lister is told', async () => {
    promote.mockImplementation(async (_o: string, _r: string, items: { masterTrackId: string }[]) => {
      // The artist answers while the previews are being prepared (after the plan's read, before the claim).
      db.tables.listing_consents.push({ id: 'x', org_id: P, release_id: RP, artist_contact_id: NOVA, state: 'no', proposed_by: AR, proposed_at: '2026-10-01', decided_by: AU1, decided_at: '2026-10-02' });
      return items.map((i) => i.masterTrackId);
    });
    const res = await list(AR, P, RP, { listed: true });
    expect(res.status).toBe(409);
    expect((await res.json()).field).toBe('consent');
    expect(row(RP).store_listed).toBe(false);
    expect(events('release.store_listed')).toHaveLength(0);
    expect(del).toHaveBeenCalled();
    expect((await publicDetail(RP)).status).toBe(404);
  });

  it('a second listing request asks nobody twice', async () => {
    await list(AR, P, RP, { listed: true });
    await list(AR, P, RP, { listed: true, playback: 'preview' });
    expect(db.tables.listing_consents).toHaveLength(2);
    expect(db.tables.notifications).toHaveLength(1);
  });

  it('a fresh listing re-asks an artist who never answered an earlier one', async () => {
    await list(AR, P, RP, { listed: true });
    await list(AR, P, RP, { listed: false });
    db.tables.notifications.length = 0;
    await list(AR, P, RP, { listed: true });
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.listing_consents).toHaveLength(2);
  });
});

describe('the artist’s answer', () => {
  beforeEach(async () => {
    await list(AR, P, RP, { listed: true });
  });

  it('a no takes the release off the store in the same request, back to preview, with both events', async () => {
    row(RP).store_playback = 'full';
    const res = await decide(AU1, P, RP, 'no');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: 'no', changed: true, unlisted: true });
    expect(consentOf(RP, NOVA)).toMatchObject({ state: 'no', decided_by: AU1 });
    expect(row(RP)).toMatchObject({ store_listed: false, store_playback: 'preview', store_listed_at: null });
    expect(events('listing.consent_decided')).toHaveLength(1);
    expect(events('listing.consent_decided')[0]).toMatchObject({ org_id: P, actor_id: AU1, audit: true, visibility: 'internal', artist_id: NOVA });
    expect(events('listing.consent_decided')[0].payload).toEqual({ decision: 'no', from: 'proposed', withdrew: true });
    expect(events('release.store_unlisted')[0].payload).toMatchObject({ reason: 'artist_declined' });
  });

  it('the public routes refuse the release the moment a no is written, even if the flag were still on', async () => {
    expect((await publicDetail(RP)).status).toBe(200);
    expect(await publicList()).toContain(RP);
    // Write ONLY the artist's no — the release row still says listed.
    db.tables.listing_consents.find((c) => c.artist_contact_id === NOVA)!.state = 'no';
    expect(row(RP).store_listed).toBe(true);
    expect((await publicDetail(RP)).status).toBe(404);
    expect((await publicAudio(RP, I1)).status).toBe(404);
    expect(await publicList()).not.toContain(RP);
  });

  it('any one artist’s no is enough, whoever else agreed', async () => {
    db.tables.listing_consents.find((c) => c.artist_contact_id === NOVA)!.state = 'yes';
    expect((await publicDetail(RP)).status).toBe(200);
    db.tables.listing_consents.find((c) => c.artist_contact_id === FEAT)!.state = 'no';
    expect((await publicDetail(RP)).status).toBe(404);
  });

  it('after a no it cannot be listed again until that artist says yes', async () => {
    await decide(AU1, P, RP, 'no');
    const blocked = await list(AR, P, RP, { listed: true });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).field).toBe('consent');
    expect(row(RP).store_listed).toBe(false);
    // The store owner cannot override it either.
    expect((await list(PU, P, RP, { listed: true })).status).toBe(409);
    expect((await decide(AU1, P, RP, 'yes')).status).toBe(200);
    expect(consentOf(RP, NOVA)!.state).toBe('yes');
    expect((await list(AR, P, RP, { listed: true })).status).toBe(200);
    expect(row(RP).store_listed).toBe(true);
    expect((await publicDetail(RP)).status).toBe(200);
  });

  it('a repeat answer writes nothing and records nothing', async () => {
    await decide(AU1, P, RP, 'no');
    const before = db.tables.activity_events.length;
    const again = await decide(AU1, P, RP, 'no');
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ changed: false, unlisted: false });
    expect(db.tables.activity_events).toHaveLength(before);
  });

  it('only the artist’s own account may answer: staff scoped to the same artist, the owner, the lister, a stranger and the signed-out get the not-found answer', async () => {
    for (const who of [STAFF, PU, AR, STRANGER, AO, null]) {
      const res = await decide(who, P, RP, 'no');
      expect([401, 403, 404], `${who} → ${res.status}`).toContain(res.status);
    }
    expect(consentOf(RP, NOVA)!.state).toBe('proposed');
    expect(row(RP).store_listed).toBe(true);
    // An artist of another org cannot answer for this release by naming it.
    expect((await decide(AO, A, RP, 'no')).status).toBe(404);
  });

  it('nothing but yes or no is an answer; the body cannot name an artist', async () => {
    expect((await decide(AU1, P, RP, 'proposed')).status).toBe(400);
    expect((await decide(AU1, P, RP, 'maybe')).status).toBe(400);
    const res = await call('consent', 'PUT', AU1, { orgId: P, releaseId: RP }, { decision: 'no', artist_contact_id: FEAT });
    expect(res.status).toBe(400);
    expect(consentOf(RP, FEAT)!.state).toBe('proposed');
  });

  it('a no whose event cannot be written still stands: the release is private, the caller is told it was not recorded', async () => {
    failVerb = 'listing.consent_decided';
    const res = await decide(AU1, P, RP, 'no');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ recorded: false, unlisted: true });
    expect(consentOf(RP, NOVA)!.state).toBe('no');
    expect(row(RP).store_listed).toBe(false);
  });

  it('a yes whose event cannot be written is put back exactly as it was', async () => {
    failVerb = 'listing.consent_decided';
    const res = await decide(AU1, P, RP, 'yes');
    expect(res.status).toBe(500);
    expect(consentOf(RP, NOVA)).toMatchObject({ state: 'proposed', proposed_by: AR });
    expect(consentOf(RP, NOVA)!.decided_at ?? null).toBeNull();
    // …and a no → yes that cannot be recorded goes back to the no.
    failVerb = null;
    await decide(AU1, P, RP, 'no');
    failVerb = 'listing.consent_decided';
    expect((await decide(AU1, P, RP, 'yes')).status).toBe(500);
    expect(consentOf(RP, NOVA)!.state).toBe('no');
  });

  it('without migration 186 an answer is 503 naming it', async () => {
    missing = new Set(['listing_consents']);
    const res = await decide(AU1, P, RP, 'no');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ migration: '186' });
  });

  it('the public store fails CLOSED on a consent table it cannot read (never "no rows")', async () => {
    broken = new Set(['listing_consents']);
    expect((await publicDetail(RP)).status).toBe(500);
    expect((await publicAudio(RP, I1)).status).toBe(500);
    const list500 = await call('publicList', 'GET', null, {});
    expect(list500.status).toBe(500);
  });

  it('GET consents without migration 186 says so and lists nothing', async () => {
    missing = new Set(['listing_consents']);
    const res = await call('consents', 'GET', AU1, { orgId: P });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaReady: false, consents: [] });
  });

  it('GET consents lists only the caller’s own questions; a member who is nobody’s artist gets an empty list', async () => {
    const mine = await (await call('consents', 'GET', AU1, { orgId: P })).json();
    expect(mine.consents).toEqual([expect.objectContaining({ releaseId: RP, state: 'proposed', listed: true, title: 'Night Shift' })]);
    expect(JSON.stringify(mine)).not.toContain(FEAT);
    expect((await (await call('consents', 'GET', STAFF, { orgId: P })).json()).consents).toEqual([]);
    expect((await call('consents', 'GET', STRANGER, { orgId: P })).status).toBe(403);
    expect((await call('consents', 'GET', null, { orgId: P })).status).toBe(401);
  });

  it('GET of the listing shows the lister the status and the artists in their scope — and the artist their own question', async () => {
    const asLister = await (await call('store', 'GET', AR, { orgId: P, releaseId: RP })).json();
    expect(asLister.consent).toMatchObject({ schemaReady: true, status: 'waiting' });
    expect(asLister.consent.artists.map((a: { name: string }) => a.name).sort()).toEqual(['Feat', 'Nova']);
    // STAFF is scoped to Nova only: Feat is neither named nor counted for them.
    const asStaff = await (await call('store', 'GET', STAFF, { orgId: P, releaseId: RP })).json().catch(() => null);
    if (asStaff?.consent?.artists) expect(asStaff.consent.artists.map((a: { name: string }) => a.name)).toEqual(['Nova']);
  });
});

describe('the store owner’s Unlist for music of connected artists', () => {
  beforeEach(() => {
    Object.assign(row(RA), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
  });

  it('lists what connected artists put on the store, only for the store owner’s own label org', async () => {
    const res = await call('connected', 'GET', PU, { orgId: L });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.releases).toEqual([expect.objectContaining({ releaseId: RA, title: 'Night Shift', artist: 'Ari', artistOrg: 'Ari', listed: true, vetoed: false, serving: true })]);
    // Field by field: no org id, no track id, no storage reference.
    expect(JSON.stringify(body)).not.toMatch(/r2:|org_id|track|audio/);
    for (const who of [LADMIN, AR, AU1, STRANGER, AO]) expect([403, 404], String(who)).toContain((await call('connected', 'GET', who, { orgId: L })).status);
    expect((await call('connected', 'GET', null, { orgId: L })).status).toBe(401);
    // The producer's own org (not a label) has no such page.
    expect((await call('connected', 'GET', PU, { orgId: P })).status).toBe(404);
  });

  it('Unlist takes it off the public store on the next request, in the label org’s rows only; Allow again puts it back', async () => {
    expect((await publicDetail(RA)).status).toBe(200);
    expect(await publicList()).toContain(RA);
    const res = await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ listed: false, changed: true });
    expect(db.tables.store_listing_vetoes).toEqual([expect.objectContaining({ release_id: RA, org_id: L, vetoed_by: PU })]);
    // The artist org's release was not written to.
    expect(row(RA).store_listed).toBe(true);
    expect((await publicDetail(RA)).status).toBe(404);
    expect((await publicAudio(RA, IA)).status).toBe(404);
    expect(await publicList()).not.toContain(RA);
    expect(events('listing.vetoed').map((e) => e.org_id).sort()).toEqual([A, L].sort());
    // …and the artist side cannot list it again: the veto holds.
    const relist = await list(AO, A, RA, { listed: true });
    expect(relist.status).toBe(409);
    expect((await relist.json()).field).toBe('veto');

    const listing = await (await call('connected', 'GET', PU, { orgId: L })).json();
    expect(listing.releases[0]).toMatchObject({ vetoed: true, serving: false });

    const allow = await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: true });
    expect(allow.status).toBe(200);
    expect(db.tables.store_listing_vetoes).toHaveLength(0);
    expect((await publicDetail(RA)).status).toBe(200);
    expect(events('listing.veto_lifted').length).toBeGreaterThan(0);
  });

  it('a repeat Unlist or Allow changes and records nothing', async () => {
    await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false });
    const before = db.tables.activity_events.length;
    const again = await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false });
    expect(await again.json()).toMatchObject({ changed: false });
    expect(db.tables.activity_events).toHaveLength(before);
  });

  it('only the store owner may; a release of an unconnected org or one that is not listed is not theirs to veto', async () => {
    for (const who of [LADMIN, AR, STRANGER, AO]) {
      expect([403, 404], String(who)).toContain((await call('veto', 'PUT', who, { orgId: L, releaseId: RA }, { listed: false })).status);
    }
    expect(db.tables.store_listing_vetoes).toHaveLength(0);
    // Another org's release (not connected to this label).
    expect((await call('veto', 'PUT', PU, { orgId: L, releaseId: RP }, { listed: false })).status).toBe(404);
    // Ended connection: not theirs any more.
    db.tables.org_connections[0].status = 'ended';
    expect((await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false })).status).toBe(404);
    db.tables.org_connections[0].status = 'active';
    row(RA).store_listed = false;
    expect((await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false })).status).toBe(409);
  });

  it('an Unlist whose event cannot be written stands; an Allow whose event cannot be written is put back', async () => {
    failVerb = 'listing.vetoed';
    const res = await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ recorded: false });
    expect(db.tables.store_listing_vetoes).toHaveLength(1);
    failVerb = 'listing.veto_lifted';
    const allow = await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: true });
    expect(allow.status).toBe(500);
    expect(db.tables.store_listing_vetoes).toHaveLength(1);
  });

  it('without migration 186 the list still reads and Unlist is 503 naming it', async () => {
    missing = new Set(['store_listing_vetoes', 'listing_consents']);
    const listing = await call('connected', 'GET', PU, { orgId: L });
    expect(listing.status).toBe(200);
    expect(await listing.json()).toMatchObject({ schemaReady: false });
    const res = await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ migration: '186' });
  });

  it('the artist org’s own listing is not a veto: allowing again lists nothing', async () => {
    await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false });
    row(RA).store_listed = false;
    await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: true });
    expect(row(RA).store_listed).toBe(false);
    expect(await publicList()).not.toContain(RA);
  });
});

describe('review fixes', () => {
  it('an artist credited on a release listed before 186 (no row) can still say no; the question is shown as asked', async () => {
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
    const mine = await (await call('consents', 'GET', AU1, { orgId: P })).json();
    expect(mine.consents).toEqual([expect.objectContaining({ releaseId: RP, state: 'proposed', listed: true })]);
    const res = await decide(AU1, P, RP, 'no');
    expect(res.status).toBe(200);
    expect(consentOf(RP, NOVA)).toMatchObject({ state: 'no', decided_by: AU1 });
    expect(row(RP).store_listed).toBe(false);
    expect(del).toHaveBeenCalled();
    expect((await publicDetail(RP)).status).toBe(404);
  });

  it('an artist who is not credited on the release cannot create a row by answering', async () => {
    db.tables.parties[0].contact_id = FEAT; // AU1 now stands for Feat, who is credited on song 1 — then remove that credit
    db.tables.track_collaborators = db.tables.track_collaborators.filter((c) => c.contact_id !== FEAT);
    expect((await decide(AU1, P, RP, 'no')).status).toBe(404);
    expect(db.tables.listing_consents).toEqual([]);
  });

  it('a veto can be lifted after the connection ended, and the list still shows it first', async () => {
    Object.assign(row(RA), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
    await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: false });
    db.tables.org_connections[0].status = 'ended';
    const list = await (await call('connected', 'GET', PU, { orgId: L })).json();
    expect(list.releases[0]).toMatchObject({ releaseId: RA, vetoed: true, artistOrg: 'Former connection' });
    expect((await call('veto', 'PUT', PU, { orgId: L, releaseId: RA }, { listed: true })).status).toBe(200);
    expect(db.tables.store_listing_vetoes).toHaveLength(0);
  });

  it('a failed consent re-check after the claim puts the claim back', async () => {
    promote.mockImplementation(async (_o: string, _r: string, items: { masterTrackId: string }[]) => {
      broken = new Set(['listing_consents']); // readable for the plan, unreadable for the re-check
      return items.map((i) => i.masterTrackId);
    });
    const res = await list(AR, P, RP, { listed: true });
    broken = new Set();
    expect(res.status).toBe(500);
    expect(row(RP).store_listed).toBe(false);
  });
});

describe('who can stand for an artist: a link someone typed in is not enough', () => {
  beforeEach(async () => {
    await list(AR, P, RP, { listed: true });
  });
  const party = (method: string, as: string, params: Record<string, string>, body: unknown) => call(params.partyId ? 'party' : 'parties', method, as, params, body);

  it('a rights writer who creates a party linking THEMSELVES to the artist cannot answer for them', async () => {
    const made = await party('POST', WRITER, { orgId: P }, { display_name: 'Sneaky', contact_id: FEAT, user_id: WRITER });
    expect(made.status, await made.clone().text()).toBe(201);
    expect((await decide(WRITER, P, RP, 'no')).status).toBe(404);
    expect((await decide(WRITER, P, RP, 'yes')).status).toBe(404);
    expect(consentOf(RP, FEAT)!.state).toBe('proposed');
    expect(((await (await call('consents', 'GET', WRITER, { orgId: P })).json()) as { consents: unknown[] }).consents).toEqual([]);
  });

  it('…nor by editing an existing party to point at themselves', async () => {
    db.tables.parties.push({ id: PF, org_id: P, kind: 'person', contact_id: FEAT, user_id: null, display_name: 'Feat' });
    const res = await party('PATCH', WRITER, { orgId: P, partyId: PF }, { user_id: WRITER });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(db.tables.parties.find((x) => x.id === PF)!.user_id).toBe(WRITER);
    expect((await decide(WRITER, P, RP, 'no')).status).toBe(404);
    expect(consentOf(RP, FEAT)!.state).toBe('proposed');
  });

  it('a link the account confirmed itself answers', async () => {
    expect((await decide(AU1, P, RP, 'no')).status).toBe(200);
  });

  it('re-linking the account clears the confirmation, so the old account stops standing for the artist', async () => {
    const res = await party('PATCH', WRITER, { orgId: P, partyId: PA_ID }, { user_id: STAFF });
    expect(res.status, await res.clone().text()).toBe(200);
    const row = db.tables.parties.find((x) => x.id === PA_ID)!;
    expect(row.details_confirmed_at ?? null).toBeNull();
    for (const who of [AU1, STAFF]) expect((await decide(who, P, RP, 'no')).status).toBe(404);
  });

  it('moving a confirmed party to another contact is refused for a writer (and an edit that clears it is not a way round)', async () => {
    const res = await party('PATCH', WRITER, { orgId: P, partyId: PA_ID }, { contact_id: FEAT });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('party_confirmed');
    expect(db.tables.parties.find((x) => x.id === PA_ID)).toMatchObject({ contact_id: NOVA, details_confirmed_by: AU1 });
    expect((await decide(AU1, P, RP, 'yes')).status).toBe(200);
  });

  it('an unconfirmed party does not even get the notification: that artist is unreachable', async () => {
    db.tables.parties[0].details_confirmed_at = null;
    db.tables.notifications.length = 0;
    await list(AR, P, RP, { listed: false });
    const res = await list(AR, P, RP, { listed: true });
    expect((await res.json()).consent).toMatchObject({ unreachable: 2, notified: 0 });
    expect(db.tables.notifications).toHaveLength(0);
  });
});

describe('put-backs never re-open a refused release; caches never hold a governed one', () => {
  it('a listing whose event cannot be written, after an artist said no in the gap, ends off the store', async () => {
    await list(AR, P, RP, { listed: true });
    // Already listed; an artist refuses while a later save of the listing cannot be recorded.
    promote.mockImplementation(async (_o: string, _r: string, items: { masterTrackId: string }[]) => items.map((i) => i.masterTrackId));
    const orig = mem.client.from.bind(mem.client);
    mem = { ...mem, client: { ...mem.client, from: (tb: string) => {
      if (tb === 'activity_events') {
        // The refusal lands just before the audit write, which then fails.
        const ins = (row: Record<string, unknown>) => {
          if (row.verb === 'release.store_listed') db.tables.listing_consents.find((c) => c.artist_contact_id === NOVA)!.state = 'no';
          const res = { data: null, error: { message: 'insert failed' } };
          const q: Record<string, unknown> = { select: () => q, single: async () => res, maybeSingle: async () => res };
          return q;
        };
        return { insert: ins };
      }
      return orig(tb);
    } } } as typeof mem;
    const res = await list(AR, P, RP, { listed: true, playback: 'preview' });
    expect(res.status).toBe(500);
    expect(row(RP).store_listed).toBe(false);
  });

  it('a yes undone to a no after the release was listed in the gap is taken off again', async () => {
    await list(AR, P, RP, { listed: true });
    await decide(AU1, P, RP, 'no'); // off the store
    expect(row(RP).store_listed).toBe(false);
    // Another artist (Feat) has no account; the lister can list again only once Nova says yes. Simulate the gap:
    failVerb = 'listing.consent_decided';
    const orig = mem.client.from.bind(mem.client);
    mem = { ...mem, client: { ...mem.client, from: (tb: string) => {
      if (tb === 'activity_events') {
        return { insert: (r: Record<string, unknown>) => {
          if (r.verb === 'listing.consent_decided') row(RP).store_listed = true; // someone listed it meanwhile
          const res = { data: null, error: { message: 'insert failed' } };
          const q: Record<string, unknown> = { select: () => q, single: async () => res, maybeSingle: async () => res };
          return q;
        } };
      }
      return orig(tb);
    } } } as typeof mem;
    expect((await decide(AU1, P, RP, 'yes')).status).toBe(500);
    expect(consentOf(RP, NOVA)!.state).toBe('no');
    expect(row(RP).store_listed).toBe(false);
  });

  it('a release an artist has a say on is never cached; one without consent rows keeps the store’s window', async () => {
    Object.assign(row(RP), { store_listed: true, store_listed_at: '2026-10-10T00:00:00Z' });
    expect((await publicDetail(RP)).headers.get('cache-control')).toMatch(/s-maxage=30/);
    db.tables.listing_consents.push({ id: 'g', org_id: P, release_id: RP, artist_contact_id: NOVA, state: 'proposed', proposed_by: AR, proposed_at: '2026-10-01', decided_by: null, decided_at: null });
    expect((await publicDetail(RP)).headers.get('cache-control')).toBe('no-store');
    expect((await publicAudio(RP, I1)).headers.get('cache-control')).toBe('no-store');
    expect((await call('publicList', 'GET', null, {})).headers.get('cache-control')).toBe('no-store');
  });
});

