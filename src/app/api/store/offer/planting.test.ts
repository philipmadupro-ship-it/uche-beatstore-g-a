/**
 * BUYER-02: an offer cannot be planted in someone else's "My beats".
 *
 * POST /api/store/offer is public, and "My beats" lists every offer stored
 * under the signed-in buyer's address. These wire the REAL offer route to the
 * REAL `/api/store/me?view=beats` route over one in-memory database, so the
 * assertion is on what the victim actually sees, not on what was inserted.
 *
 * Contract:
 * - anonymous caller typing a victim's address: stored (the producer still
 *   hears about it, flagged unverified) but absent from the victim's My beats
 * - signed-in caller typing a victim's address: the session's email is used,
 *   so the offer lands under the CALLER, not the victim
 * - an offer a buyer makes while signed in as themselves does appear for them
 * - before migration 139 (no column) offers still reach the producer, and My
 *   beats shows none
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const VICTIM = 'victim@example.test';
const ATTACKER = 'attacker@example.test';
const SELLER = 'producer-1';
const TRACK = '11111111-1111-4111-8111-111111111111';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let hasVerifiedColumn = true;
let nextId = 1;

function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  let error: unknown = null;
  let inserted: Row | null = null;
  const match = () => (tables[table] ?? []).filter(
    (r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
  );
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      if (table === 'buyer_offers' && c === 'buyer_email_verified' && !hasVerifiedColumn) {
        error = { code: '42703', message: 'column buyer_offers.buyer_email_verified does not exist' };
      }
      filters.push([c, v]);
      return q;
    },
    in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return q; },
    order: () => q,
    maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
    single: () => Promise.resolve(error ? { data: null, error } : { data: inserted ?? match()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(error ? { data: null, error } : { data: match(), error: null }).then(res, rej),
  };
  return {
    ...q,
    insert: (row: Row) => {
      if (table === 'buyer_offers' && 'buyer_email_verified' in row && !hasVerifiedColumn) {
        error = { code: 'PGRST204', message: "Could not find the 'buyer_email_verified' column of 'buyer_offers' in the schema cache" };
        return q;
      }
      inserted = { id: `row-${nextId++}`, status: 'pending', created_at: '2026-10-02T10:00:00Z', ...row };
      (tables[table] ??= []).push(inserted);
      return q;
    },
  };
}

const emails: Record<string, string> = { 'user-victim': VICTIM, 'user-attacker': ATTACKER };
const session: { userId: string | null } = { userId: null };
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: () => Promise.resolve(true), clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => Promise.resolve(session.userId ? { ok: true, userId: session.userId } : { ok: false }),
  createServiceClient: () => ({
    from,
    auth: { admin: { getUserById: (id: string) => Promise.resolve({ data: { user: { email: emails[id] ?? null } } }) } },
  }),
}));

const offer = (buyer_email: string, price = 1) => new NextRequest('http://localhost/api/store/offer', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ track_id: TRACK, buyer_email, offered_price_usd: price }),
});

async function victimsBeats() {
  session.userId = 'user-victim';
  const { GET } = await import('../me/route');
  const res = await GET(new NextRequest('http://localhost/api/store/me?session=1&view=beats'));
  expect(res.status).toBe(200);
  return (await res.json()).beats as Array<{ id: string; status: string; offer: { price_usd: number } | null }>;
}

beforeEach(() => {
  hasVerifiedColumn = true;
  nextId = 1;
  session.userId = null;
  tables = {
    tracks: [{
      id: TRACK, title: 'Night Shift', user_id: SELLER, store_listed: true, cover_url: null, type: 'beat',
      bpm: 140, key: 'F', scale: 'minor', duration_seconds: 100,
    }],
    license_purchases: [], project_access_links: [], project_tracks: [], notifications: [], buyer_offers: [],
  };
});

describe('planting an offer', () => {
  it("an anonymous offer typed with the victim's address never reaches the victim's My beats", async () => {
    const { POST } = await import('./route');
    const res = await POST(offer(VICTIM, 1));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, verified: false });

    // stored — the producer still sees it, marked unverified
    expect(tables.buyer_offers).toHaveLength(1);
    expect(tables.buyer_offers[0]).toMatchObject({ buyer_email: VICTIM, buyer_email_verified: false });
    expect(String(tables.notifications[0]?.body)).toContain('(unverified)');

    expect(await victimsBeats()).toEqual([]);
  });

  it('a signed-in caller cannot name another address: the session email is used', async () => {
    session.userId = 'user-attacker';
    const { POST } = await import('./route');
    expect(await (await POST(offer(VICTIM, 1))).json()).toMatchObject({ verified: true });

    expect(tables.buyer_offers[0]).toMatchObject({ buyer_email: ATTACKER, buyer_email_verified: true });
    expect(await victimsBeats()).toEqual([]);
  });

  it('an offer made while signed in as yourself shows in your own My beats', async () => {
    session.userId = 'user-victim';
    const { POST } = await import('./route');
    // the body email is ignored even when it differs
    await POST(offer('typo@example.test', 250));

    expect(tables.buyer_offers[0]).toMatchObject({ buyer_email: VICTIM, buyer_email_verified: true });
    const beats = await victimsBeats();
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ id: TRACK, status: 'requested', offer: { price_usd: 250 } });
  });

  it('a planted offer beside a real one: only the real one is shown', async () => {
    const { POST } = await import('./route');
    await POST(offer(VICTIM, 1)); // planted, anonymous
    session.userId = 'user-victim';
    await POST(offer(VICTIM, 400)); // real, signed in
    const beats = await victimsBeats();
    expect(beats.map((b) => b.offer?.price_usd)).toEqual([400]);
  });

  it('before migration 139 the producer still gets the offer and My beats shows none', async () => {
    hasVerifiedColumn = false;
    const { POST } = await import('./route');
    expect((await POST(offer(VICTIM, 1))).status).toBe(200);
    session.userId = 'user-victim';
    await POST(offer(VICTIM, 400));
    expect(tables.buyer_offers).toHaveLength(2); // inserted without the column
    expect(await victimsBeats()).toEqual([]);
  });
});
