/**
 * POST /api/org/[orgId]/releases/[releaseId]/withdraw (LABEL-56) through the
 * REAL lib/auth/org-access, release-withdrawal and activity writer against an
 * in-memory database. Only the bytes are stubbed (`deletePromotedPreviews` is
 * a spy).
 *
 *   L: artists Nova (C1), Kilo (C2); releases R1 (Nova's, delivered), R2
 *   (Kilo's, draft), R3 (Nova's, delivered AND on the store). Members: owner,
 *   A&R (release.write), marketing (no release.write), A&R scoped to Kilo.
 *   L2's owner X.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const MKT = u(3);
const AR_C2 = u(5);
const X = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const R3 = '70000000-0000-4000-8000-000000000003';
const RX = '70000000-0000-4000-8000-000000000004';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
/** Make the audit insert fail, as a database that lost the event write would. */
let failEvents = false;
/** Refuse a release UPDATE the way the pre-193 state CHECK does. */
let oldStateCheck = false;
/** Runs when the release UPDATE is attempted: i.e. after the row was read, before the claim lands. */
let beforeClaim: (() => void) | null = null;
const del = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const real = mem.client.from(table);
      if (failEvents && table === 'activity_events') {
        const res = { data: null, error: { message: 'insert failed' } };
        const q: Record<string, unknown> = {};
        for (const m of ['insert', 'select']) q[m] = () => q;
        q.single = async () => res;
        q.maybeSingle = async () => res;
        return q;
      }
      if (table === 'releases') {
        return new Proxy(real, {
          get(target, prop, receiver) {
            if (prop === 'update') {
              return (values: Record<string, unknown>) => {
                if (values.state === 'withdrawn') {
                  beforeClaim?.();
                  if (oldStateCheck) {
                    const res = { data: null, error: { code: '23514', message: 'new row for relation "releases" violates check constraint "releases_state_check"' } };
                    const q: Record<string, unknown> = {};
                    for (const m of ['eq', 'is', 'select']) q[m] = () => q;
                    q.maybeSingle = async () => res;
                    return q;
                  }
                }
                return (Reflect.get(target, prop, receiver) as (v: unknown) => unknown).call(target, values);
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      }
      return real;
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/storage/store-release-media', () => ({
  promotePreviews: async () => [],
  deletePromotedPreviews: (...args: unknown[]) => del(...args),
}));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
function release(id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) {
  return {
    id, org_id: org, project_id: project, contact_id: contact, title: 'Nova EP', type: 'single', upc: null, label_name: null, c_line: null,
    p_line: null, primary_genre: null, target_date: null, release_date: '2026-10-01', artwork_asset_id: null, state: 'draft',
    delivered_at: null, delivered_to: null, imported_released: false, store_listed: false, store_listed_at: null, store_playback: 'preview',
    created_by: OWN, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...extra,
  };
}
const delivered = { state: 'delivered', delivered_at: '2026-10-01T12:00:00.000Z', delivered_to: 'DistroKid' };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  failEvents = false;
  oldStateCheck = false;
  beforeClaim = null;
  del.mockReset();
  db = {
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null, settings: {} },
        { id: L2, kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      releases: [
        release(R1, L, LP1, C1, delivered),
        release(R2, L, LP2, C2),
        release(R3, L, LP1, C1, { ...delivered, store_listed: true, store_listed_at: '2026-10-02T00:00:00.000Z', store_playback: 'full' }),
        release(RX, L2, XP1, CX, delivered),
      ],
      release_items: [],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function withdraw(as: string | null, org: string, id: string, body: unknown = {}) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/releases/${id}/withdraw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mod.POST(req, { params: Promise.resolve({ orgId: org, releaseId: id }) });
}

const row = (id: string) => db.tables.releases.find((r) => r.id === id)!;
const events = (verb: string) => db.tables.activity_events.filter((e) => e.verb === verb);

describe('withdrawing a delivered release', () => {
  it('moves it to withdrawn, keeps the record, and writes one internal audit event with the reason', async () => {
    const res = await withdraw(AR, L, R1, { note: '  wrong master  ' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.release).toMatchObject({ state: 'withdrawn', deliveredTo: 'DistroKid', deliveredAt: '2026-10-01T12:00:00.000Z' });
    expect(body.unlisted).toBe(false);
    expect(row(R1)).toMatchObject({ state: 'withdrawn', delivered_to: 'DistroKid', title: 'Nova EP' });
    expect(events('release.withdrawn')).toHaveLength(1);
    expect(events('release.withdrawn')[0]).toMatchObject({ org_id: L, actor_id: AR, release_id: R1, artist_id: C1, audit: true, visibility: 'internal' });
    expect(events('release.withdrawn')[0].payload).toEqual({ title: 'Nova EP', wasListed: false, unlisted: false, note: 'wrong master' });
    expect(events('release.store_unlisted')).toHaveLength(0);
  });

  it('a second call is 409 and writes no second event', async () => {
    expect((await withdraw(OWN, L, R1)).status).toBe(200);
    const again = await withdraw(OWN, L, R1);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/already withdrawn/);
    expect(events('release.withdrawn')).toHaveLength(1);
  });

  it('two requests at once: the one that lost the claim is 409, writes no event and does not overwrite the winner', async () => {
    beforeClaim = () => {
      Object.assign(row(R1), { state: 'withdrawn' });
    };
    const res = await withdraw(OWN, L, R1);
    expect(res.status).toBe(409);
    expect(row(R1).state).toBe('withdrawn');
    expect(events('release.withdrawn')).toHaveLength(0);
  });

  it('only a delivered release: a draft is told to cancel it', async () => {
    const res = await withdraw(AR, L, R2);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/cancel/);
    expect(row(R2).state).toBe('draft');
    expect(db.tables.activity_events).toHaveLength(0);
  });
});

describe('a listed release comes off the store by LABEL-42’s unlist', () => {
  it('unlists in the same step, resets playback to preview, and records the unlisting too', async () => {
    const res = await withdraw(OWN, L, R3);
    expect(res.status).toBe(200);
    expect((await res.json()).unlisted).toBe(true);
    expect(row(R3)).toMatchObject({ state: 'withdrawn', store_listed: false, store_listed_at: null, store_playback: 'preview' });
    expect(events('release.withdrawn')[0].payload).toMatchObject({ wasListed: true, unlisted: true });
    expect(events('release.store_unlisted')).toHaveLength(1);
  });

  it('previews of music that was publicly out are kept, whatever was asked', async () => {
    const res = await withdraw(OWN, L, R3, { delete_previews: true });
    expect((await res.json()).previewsDeleted).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('previews of music that was never publicly out are deleted only when asked', async () => {
    Object.assign(row(R3), { release_date: '2027-01-01' });
    expect((await (await withdraw(OWN, L, R3)).json()).previewsDeleted).toBe(false);
    expect(del).not.toHaveBeenCalled();
    Object.assign(row(R3), { state: 'delivered', store_listed: true, store_listed_at: '2026-10-02T00:00:00.000Z' });
    const res = await withdraw(OWN, L, R3, { delete_previews: true });
    expect((await res.json()).previewsDeleted).toBe(true);
    expect(del).toHaveBeenCalledWith(R3);
  });
});

describe('no withdrawal without its record', () => {
  it('if the audit event cannot be written the delivery (and its listing) is put back', async () => {
    failEvents = true;
    const res = await withdraw(OWN, L, R3);
    expect(res.status).toBe(500);
    expect(row(R3)).toMatchObject({ state: 'delivered', store_listed: true, store_listed_at: '2026-10-02T00:00:00.000Z', store_playback: 'full' });
    expect(db.tables.activity_events).toHaveLength(0);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('before migration 193', () => {
  it('answers 503 naming 193 and changes nothing', async () => {
    oldStateCheck = true;
    const res = await withdraw(OWN, L, R3);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ migration: '193', schemaReady: false });
    expect(row(R3)).toMatchObject({ state: 'delivered', store_listed: true });
    expect(db.tables.activity_events).toHaveLength(0);
  });
});

describe('who may withdraw', () => {
  it('needs release.write: marketing is 403', async () => {
    expect((await withdraw(MKT, L, R1)).status).toBe(403);
    expect(row(R1).state).toBe('delivered');
  });
  it('a member limited to Kilo cannot reach Nova’s release (404); another org’s owner neither', async () => {
    expect((await withdraw(AR_C2, L, R1)).status).toBe(404);
    expect((await withdraw(X, L, R1)).status).toBe(404);
    expect((await withdraw(OWN, L, RX)).status).toBe(404);
    expect(row(R1).state).toBe('delivered');
    expect(row(RX).state).toBe('delivered');
  });
  it('signed out is 401', async () => {
    expect((await withdraw(null, L, R1)).status).toBe(401);
  });
  it('a release entered as already out is the owner’s or an admin’s', async () => {
    Object.assign(row(R1), { imported_released: true });
    expect((await withdraw(AR, L, R1)).status).toBe(403);
    expect((await withdraw(OWN, L, R1)).status).toBe(200);
  });
  it('a body with unknown keys is a 400', async () => {
    expect((await withdraw(OWN, L, R1, { state: 'cancelled' })).status).toBe(400);
  });
});
