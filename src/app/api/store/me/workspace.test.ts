/**
 * BUYER-01: "My beats" on /api/store/me — owned + requested beats, and
 * "Create project" (a buyer playlist made from a selection).
 *
 * Runs against an in-memory PostgREST stand-in that really filters, so the
 * cross-buyer cases test the query, not a canned answer.
 *
 * Contract:
 * - no identity → 400, nothing read
 * - view=beats returns only THIS email's purchases and offers; another buyer's
 *   rows never appear, an email in the query string is ignored
 * - a session and a token for the same human get the same rows
 * - offers made on an unverified address (mig 139) are not shown
 * - revoked purchases own nothing; a delisted beat that is only requested
 *   leaks no metadata; no media URL is in the JSON
 * - create_playlist with track_ids: all-or-nothing, listed or owned only,
 *   keyed on the proven email; a bad id writes nothing
 * - add_to_playlist accepts a delisted beat the buyer paid for, and refuses
 *   one they did not
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ME = 'rapper@example.test';
const OTHER = 'someone@example.test';
const A = '11111111-1111-4111-8111-111111111111'; // listed, owned
const B = '22222222-2222-4222-8222-222222222222'; // delisted exclusive, owned
const C = '33333333-3333-4333-8333-333333333333'; // listed, offered on
const D = '44444444-4444-4444-8444-444444444444'; // delisted, offered on only
const E = '55555555-5555-4555-8555-555555555555'; // listed, not mine
const PL = '66666666-6666-4666-8666-666666666666';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  reads.push({ table, filters });
  const match = () => (tables[table] ?? []).filter(
    (r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
  );
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
    in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return q; },
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: { id: PL, name: 'Mine', created_at: 'x', updated_at: 'x' }, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: match(), error: null }).then(res, rej),
  };
  const write = (op: string) => (payload?: unknown) => {
    writes.push({ table, op, payload });
    return q;
  };
  return { ...q, insert: write('insert'), upsert: write('upsert'), update: write('update'), delete: write('delete') };
}

const session: { userId: string | null; email: string | null } = { userId: null, email: null };
const mockVerify = vi.fn();
vi.mock('@/lib/buyer-tokens', () => ({ verifyBuyerToken: (t: string) => mockVerify(t) }));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => Promise.resolve(session.userId ? { ok: true, userId: session.userId } : { ok: false }),
  createServiceClient: () => ({
    from,
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: { email: session.email } } }) } },
  }),
}));

const get = (query: string) => new NextRequest(`http://localhost/api/store/me${query}`);
const post = (body: unknown, query = '?session=1') => new NextRequest(`http://localhost/api/store/me${query}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const meta = (id: string, over: Row = {}): Row => ({
  id, title: `Beat ${id.slice(0, 1)}`, cover_url: null, type: 'beat', bpm: 140, key: 'F', scale: 'minor',
  duration_seconds: 100, store_listed: true,
  // would be a leak if they ever reached the response
  wav_url: 'r2://private/master.wav', audio_url: 'r2://private/a.mp3', preview_url: 'https://cdn/p.mp3',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  reads.length = 0;
  session.userId = 'u1';
  session.email = 'Rapper@Example.test'; // mixed case on purpose
  mockVerify.mockImplementation((t: string) => (t === 'good' ? { email: ME } : null));
  tables = {
    tracks: [
      meta(A), meta(B, { store_listed: false, title: 'Exclusive One' }),
      meta(C), meta(D, { store_listed: false, title: 'Secret Title', bpm: 99 }), meta(E),
    ],
    license_purchases: [
      {
        id: 'lp1', buyer_email: ME, amount_usd: 50, status: 'paid', stripe_session_id: 'cs_1', created_at: '2026-09-10T00:00:00Z',
        download_unlocked: true, line_items: [{ track_id: A, license_id: 'l1', license_type: 'lease' }],
      },
      {
        id: 'lp2', buyer_email: ME, amount_usd: 900, status: 'paid', stripe_session_id: 'cs_2', created_at: '2026-09-11T00:00:00Z',
        download_unlocked: true, line_items: [{ track_id: B, license_id: 'l2', license_type: 'exclusive' }],
      },
      {
        id: 'lp3', buyer_email: OTHER, amount_usd: 50, status: 'paid', stripe_session_id: 'cs_3', created_at: '2026-09-10T00:00:00Z',
        download_unlocked: true, line_items: [{ track_id: E, license_id: 'l1', license_type: 'lease' }],
      },
    ],
    project_access_links: [],
    project_tracks: [],
    buyer_offers: [
      { id: 'o1', buyer_email: ME, track_id: C, track_title: 'Beat 3', offered_price_usd: 300, status: 'pending', created_at: '2026-09-12T00:00:00Z', message: 'private note', seller_user_id: 'prod', buyer_email_verified: true },
      { id: 'o2', buyer_email: ME, track_id: D, track_title: 'Stored D', offered_price_usd: 80, status: 'countered', created_at: '2026-09-13T00:00:00Z', seller_user_id: 'prod', buyer_email_verified: true },
      { id: 'o3', buyer_email: OTHER, track_id: E, track_title: 'Beat 5', offered_price_usd: 1, status: 'pending', created_at: '2026-09-14T00:00:00Z', seller_user_id: 'prod', buyer_email_verified: true },
      // typed into the public offer form by someone else: claims ME's address, proves nothing
      { id: 'o4', buyer_email: ME, track_id: E, track_title: 'Beat 5', offered_price_usd: 1, status: 'pending', created_at: '2026-09-15T00:00:00Z', seller_user_id: 'prod', buyer_email_verified: false },
    ],
    buyer_playlists: [{ id: PL, email: ME, name: 'Mine' }],
    buyer_playlist_tracks: [],
  };
});

describe('GET /api/store/me?view=beats', () => {
  it('400s with no identity and reads nothing', async () => {
    session.userId = null;
    const { GET } = await import('./route');
    const res = await GET(get('?view=beats'));
    expect(res.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it("returns this buyer's owned and requested beats only", async () => {
    const { GET } = await import('./route');
    const res = await GET(get('?session=1&view=beats&email=someone@example.test'));
    expect(res.status).toBe(200);
    const { email, beats } = await res.json();
    expect(email).toBe(ME);
    expect(beats.map((b: { id: string; status: string }) => [b.id, b.status]).sort()).toEqual([
      [A, 'owned'], [B, 'owned'], [C, 'requested'], [D, 'requested'],
    ]);
    // o4 names ME's address on E but was never verified (a planted offer)
    expect(beats.find((b: { id: string }) => b.id === E)).toBeUndefined();
    expect(reads.find((x) => x.table === 'buyer_offers')?.filters).toContainEqual(['buyer_email_verified', true]);
    // every read of a buyer-keyed table was scoped to the proven email
    for (const r of reads.filter((x) => ['license_purchases', 'project_access_links', 'buyer_offers'].includes(x.table))) {
      expect(r.filters).toContainEqual(['buyer_email', ME]);
    }
  });

  it('a token for the same human returns the same rows', async () => {
    const { GET } = await import('./route');
    const viaSession = await (await GET(get('?session=1&view=beats'))).json();
    session.userId = null;
    const viaToken = await (await GET(get('?token=good&view=beats'))).json();
    expect(viaToken).toEqual(viaSession);
  });

  it('a revoked purchase owns nothing', async () => {
    (tables.license_purchases[1] as Row).download_unlocked = false;
    const { GET } = await import('./route');
    const { beats } = await (await GET(get('?session=1&view=beats'))).json();
    expect(beats.map((b: { id: string }) => b.id)).not.toContain(B);
  });

  it('a bundle the buyer bought brings in its tracks; an expired one does not', async () => {
    tables.project_access_links = [
      { id: 'pa1', buyer_email: ME, project_id: 'proj1', token: 'tok1', amount_usd: 20, created_at: '2026-09-01T00:00:00Z', expires_at: null },
      { id: 'pa2', buyer_email: ME, project_id: 'proj2', token: 'tok2', amount_usd: 20, created_at: '2026-09-01T00:00:00Z', expires_at: '2020-01-01T00:00:00Z' },
    ];
    tables.projects = [{ id: 'proj1', name: 'P1', cover_url: null }, { id: 'proj2', name: 'P2', cover_url: null }];
    tables.project_tracks = [{ project_id: 'proj1', track_id: E }, { project_id: 'proj2', track_id: C }];
    const { GET } = await import('./route');
    const { beats } = await (await GET(get('?session=1&view=beats'))).json();
    const e = beats.find((b: { id: string }) => b.id === E);
    expect(e).toMatchObject({ status: 'owned', openUrl: '/store/projects/access/tok1' });
    // C stays requested: proj2 is expired
    expect(beats.find((b: { id: string }) => b.id === C).status).toBe('requested');
  });

  it('a delisted beat that is only requested leaks no metadata; nothing carries a media url', async () => {
    const { GET } = await import('./route');
    const body = await (await GET(get('?session=1&view=beats'))).json();
    const d = body.beats.find((b: { id: string }) => b.id === D);
    expect(d).toMatchObject({ title: 'Stored D', bpm: null, cover_url: null, available: false, listed: false, playable: false });
    const text = JSON.stringify(body);
    for (const leak of ['r2://', 'wav_url', 'audio_url', 'preview_url', 'private note', 'seller_user_id', 'Secret Title']) {
      expect(text).not.toContain(leak);
    }
  });

  it('a delisted beat the buyer owns still shows and can play, but has no storefront page', async () => {
    const { GET } = await import('./route');
    const { beats } = await (await GET(get('?session=1&view=beats'))).json();
    expect(beats.find((b: { id: string }) => b.id === B)).toMatchObject({
      title: 'Exclusive One', listed: false, playable: true, canAddToProject: true, license: 'exclusive', openUrl: '/store/download?session_id=cs_2',
    });
  });

  it('the default GET is unchanged: no beats field, no purchase reads', async () => {
    const { GET } = await import('./route');
    const body = await (await GET(get('?session=1'))).json();
    expect(body).toHaveProperty('playlists');
    expect(body).not.toHaveProperty('beats');
    expect(reads.map((r) => r.table)).not.toContain('buyer_offers');
  });
});

describe('create_playlist from a selection ("Create project")', () => {
  it('creates the playlist and adds listed and owned beats in order, keyed on the proven email', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'create_playlist', name: 'Album', track_ids: [A, B, C], email: OTHER }));
    expect(res.status).toBe(200);
    expect((await res.json()).playlist.track_ids).toEqual([A, B, C]);
    expect(writes).toEqual([
      { table: 'buyer_playlists', op: 'insert', payload: { email: ME, name: 'Album' } },
      { table: 'buyer_playlist_tracks', op: 'insert', payload: [
        { playlist_id: PL, track_id: A, position: 0 },
        { playlist_id: PL, track_id: B, position: 1 },
        { playlist_id: PL, track_id: C, position: 2 },
      ] },
    ]);
  });

  it("404s and writes nothing when any beat is neither listed nor the buyer's", async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'create_playlist', name: 'Album', track_ids: [A, D] }));
    expect(res.status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it("another buyer's exclusive is not addable to this buyer's project", async () => {
    tables.license_purchases.push({
      id: 'lp9', buyer_email: OTHER, status: 'paid', created_at: '2026-09-01T00:00:00Z', download_unlocked: true,
      line_items: [{ track_id: D, license_id: 'l2', license_type: 'exclusive' }],
    });
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'create_playlist', name: 'Steal', track_ids: [D] }));
    expect(res.status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it('rejects more than 50 beats and non-uuid ids at the contract', async () => {
    const { POST } = await import('./route');
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await POST(post({ action: 'create_playlist', name: 'x', track_ids: many }))).status).toBe(400);
    expect((await POST(post({ action: 'create_playlist', name: 'x', track_ids: ['nope'] }))).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('without track_ids it still makes an empty playlist, as before', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'create_playlist', name: 'Empty' }));
    expect(res.status).toBe(200);
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(['buyer_playlists:insert']);
  });
});

describe('add_to_playlist and ownership', () => {
  it('accepts a delisted beat the buyer paid for', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'add_to_playlist', playlist_id: PL, track_id: B }));
    expect(res.status).toBe(200);
    expect(writes.map((w) => `${w.table}:${w.op}`)).toContain('buyer_playlist_tracks:upsert');
  });

  it('still refuses a delisted beat they did not buy', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'add_to_playlist', playlist_id: PL, track_id: D }));
    expect(res.status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it('a refunded exclusive no longer lets the buyer add it', async () => {
    (tables.license_purchases[1] as Row).download_unlocked = false;
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'add_to_playlist', playlist_id: PL, track_id: B }));
    expect(res.status).toBe(404);
  });
});
