/**
 * POST /api/org/[orgId]/releases/[releaseId]/deliver (LABEL-33) through the
 * REAL lib/auth/org-access, release-delivery and activity writer against an
 * in-memory database. The readiness itself is LABEL-32's and has its own
 * tests; here it is stubbed to "ready" or "blocked" so each rule of delivery
 * is exercised on its own.
 *
 *   L: artists Nova (C1), Kilo (C2); release R1 (Nova's), R2 (Kilo's).
 *   Members: owner, A&R (release.write, not owner), marketing (no release.write),
 *   A&R scoped to Kilo. L2's owner X. The producer's workspace has no release.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import type { ReleaseReadiness, GateState, ReleaseGate } from '@/lib/labelos/release-readiness';

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
const RX = '70000000-0000-4000-8000-000000000003';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let ready = false;
let notReadySchema = false;
/** Make the audit insert fail, as a database that lost the event write would. */
let failEvents = false;
/** Runs while readiness is being worked out, i.e. after the release row was read and before the claim. */
let duringReadiness: (() => void) | null = null;

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
vi.mock('@/lib/labelos/release-readiness-store', async () => {
  class ReleaseReadinessNotReadyError extends Error {}
  return {
    ReleaseReadinessNotReadyError,
    loadReleaseReadinessFacts: async () => {
      if (notReadySchema) throw new ReleaseReadinessNotReadyError();
      return { stub: true };
    },
  };
});
vi.mock('@/lib/labelos/release-readiness', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/labelos/release-readiness')>();
  return {
    ...real,
    evaluateReleaseReadiness: (): ReleaseReadiness => {
      duringReadiness?.();
      const gate = (status: GateState['status'], sensitive = false): GateState => ({
        status,
        blockers: status === 'blocked' ? [{ code: 'x', message: sensitive ? 'IPI of Nova is missing' : 'Add the cover', gate: 'artwork', fixCapability: 'release.write', sensitive }] : [],
        warnings: [],
        approval: null,
      });
      const gates = Object.fromEntries(real.RELEASE_GATES.map((g) => [g, gate(ready ? 'satisfied' : 'satisfied')])) as Record<ReleaseGate, GateState>;
      if (!ready) {
        gates.artwork = gate('blocked');
        gates.credits_splits = gate('blocked', true);
      }
      return { releaseState: 'draft', gates, readyToDeliver: ready };
    },
  };
});

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
function release(id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) {
  return {
    id, org_id: org, project_id: project, contact_id: contact, title: 'Nova EP', type: 'single', upc: null, label_name: null, c_line: null,
    p_line: null, primary_genre: null, target_date: null, release_date: null, artwork_asset_id: null, state: 'draft',
    delivered_at: null, delivered_to: null, imported_released: false, store_listed: false, store_listed_at: null, created_by: OWN,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  ready = false;
  notReadySchema = false;
  failEvents = false;
  duringReadiness = null;
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
      releases: [release(R1, L, LP1, C1), release(R2, L, LP2, C2), release(RX, L2, XP1, CX)],
      release_items: [],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function deliver(as: string | null, org: string, id: string, body: unknown = { distributor: 'DistroKid' }) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/releases/${id}/deliver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mod.POST(req, { params: Promise.resolve({ orgId: org, releaseId: id }) });
}

const row = (id: string) => db.tables.releases.find((r) => r.id === id)!;
const events = () => db.tables.activity_events.filter((e) => e.verb === 'release.delivered');

describe('a ready release', () => {
  beforeEach(() => {
    ready = true;
  });

  it('delivers, records the distributor and the date, and writes one audit event', async () => {
    const res = await deliver(AR, L, R1, { distributor: 'DistroKid', delivered_on: '2026-10-12' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.override).toBe(false);
    expect(body.release).toMatchObject({ state: 'delivered', deliveredTo: 'DistroKid', deliveredAt: '2026-10-12T12:00:00.000Z' });
    expect(row(R1)).toMatchObject({ state: 'delivered', delivered_to: 'DistroKid' });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ org_id: L, actor_id: AR, release_id: R1, artist_id: C1, audit: true, visibility: 'artist' });
    expect(events()[0].payload).toEqual({ distributor: 'DistroKid', deliveredAt: '2026-10-12T12:00:00.000Z', override: false });
  });

  it('a second call is 409 and writes no second event', async () => {
    expect((await deliver(OWN, L, R1)).status).toBe(200);
    const again = await deliver(OWN, L, R1);
    expect(again.status).toBe(409);
    expect(events()).toHaveLength(1);
  });

  it('two requests at once: the one that lost the claim is a 409, writes no event, and does not overwrite the winner', async () => {
    ready = true;
    // Another request delivers between this one's read of the row (draft) and its claim.
    duringReadiness = () => {
      Object.assign(db.tables.releases.find((r) => r.id === R1) as Record<string, unknown>, { state: 'delivered', delivered_at: '2026-10-01T09:00:00.000Z', delivered_to: 'Winner' });
    };
    const res = await deliver(OWN, L, R1, { distributor: 'Loser' });
    expect(res.status).toBe(409);
    expect(db.tables.releases.find((r) => r.id === R1)).toMatchObject({ state: 'delivered', delivered_to: 'Winner', delivered_at: '2026-10-01T09:00:00.000Z' });
    expect(db.tables.activity_events.filter((e) => e.verb === 'release.delivered')).toHaveLength(0);
  });

  it('a body without a distributor is 400 and nothing changes', async () => {
    for (const body of [{}, { distributor: '   ' }, { distributor: 'X', extra: 1 }, { distributor: 'X', delivered_on: 'yesterday' }]) {
      expect((await deliver(OWN, L, R1, body)).status).toBe(400);
    }
    expect(row(R1).state).toBe('draft');
    expect(events()).toHaveLength(0);
  });

  it('a cancelled release is 409', async () => {
    row(R1).state = 'cancelled';
    expect((await deliver(OWN, L, R1)).status).toBe(409);
    expect(events()).toHaveLength(0);
  });

  it('an override on a ready release is an ordinary delivery with no override record', async () => {
    const res = await deliver(OWN, L, R1, { distributor: 'DistroKid', override: true, override_note: 'belt and braces' });
    expect(res.status).toBe(200);
    expect((await res.json()).override).toBe(false);
    expect(events()[0].payload).not.toHaveProperty('overrideNote');
  });
});

describe('a release with gates open', () => {
  it('is refused with the gates (422), a draft stays a draft, and no event is written', async () => {
    const res = await deliver(OWN, L, R1);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.readiness.gates.artwork.status).toBe('blocked');
    expect(row(R1).state).toBe('draft');
    expect(events()).toHaveLength(0);
  });

  it('names a rights blocker only to someone with rights.read', async () => {
    const withRights = await (await deliver(AR, L, R1)).json();
    expect(JSON.stringify(withRights)).toContain('IPI of Nova');
    // Strip rights.read from the A&R member.
    db.tables.org_members.find((m) => m.user_id === AR)!.cap_revokes = ['rights.read'];
    const without = await (await deliver(AR, L, R1)).json();
    expect(JSON.stringify(without)).not.toContain('IPI of Nova');
    expect(without.readiness.gates.credits_splits.withheld).toBe(1);
  });

  it('an owner overrides with a note: delivered, flagged, and the event is internal with the note and open gates', async () => {
    const res = await deliver(OWN, L, R1, { distributor: 'Believe', override: true, override_note: 'Label approved by email' });
    expect(res.status).toBe(200);
    expect((await res.json()).override).toBe(true);
    expect(row(R1).state).toBe('delivered');
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ audit: true, visibility: 'internal' });
    expect(events()[0].payload).toMatchObject({ distributor: 'Believe', override: true, overrideNote: 'Label approved by email' });
    expect((events()[0].payload as { openGates: string[] }).openGates).toEqual(expect.arrayContaining(['artwork', 'credits_splits']));
  });

  it('an override without a note is 400, with a blank one too — and nothing is delivered', async () => {
    for (const note of [undefined, '', '   ']) {
      const res = await deliver(OWN, L, R1, { distributor: 'Believe', override: true, ...(note === undefined ? {} : { override_note: note }) });
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe('override_note');
    }
    expect(row(R1).state).toBe('draft');
    expect(events()).toHaveLength(0);
  });

  it('a non-owner asking to override is 403, note or not', async () => {
    const res = await deliver(AR, L, R1, { distributor: 'Believe', override: true, override_note: 'trust me' });
    expect(res.status).toBe(403);
    expect(row(R1).state).toBe('draft');
    expect(events()).toHaveLength(0);
  });
});

describe('who may deliver', () => {
  beforeEach(() => {
    ready = true;
  });

  it('401 signed out, 403 without release.write', async () => {
    expect((await deliver(null, L, R1)).status).toBe(401);
    expect((await deliver(MKT, L, R1)).status).toBe(403);
    expect(row(R1).state).toBe('draft');
  });

  it('is 404 outside the member’s artists, in another org, for a missing id', async () => {
    expect((await deliver(AR_C2, L, R1)).status).toBe(404); // Nova's release, member scoped to Kilo
    expect((await deliver(OWN, L, RX)).status).toBe(404); // L2's release through L
    expect((await deliver(X, L2, R1)).status).toBe(404); // L's release through L2
    expect((await deliver(OWN, L, '70000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect(db.tables.releases.filter((r) => r.state !== 'draft')).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  it('a scoped member delivers a release of their own artist', async () => {
    expect((await deliver(AR_C2, L, R2)).status).toBe(200);
  });
});

describe('failure modes', () => {
  it('migration 144/153/155/157 missing is a 503 naming it, not a 500', async () => {
    notReadySchema = true;
    const res = await deliver(OWN, L, R1);
    expect(res.status).toBe(503);
    expect(row(R1).state).toBe('draft');
  });

  it('if the audit event cannot be written the delivery is put back (500, still a draft)', async () => {
    ready = true;
    failEvents = true;
    const res = await deliver(OWN, L, R1);
    expect(res.status).toBe(500);
    expect(row(R1)).toMatchObject({ state: 'draft', delivered_at: null, delivered_to: null });
    failEvents = false;
    // …and it can be delivered once the record can be written.
    expect((await deliver(OWN, L, R1)).status).toBe(200);
    expect(events()).toHaveLength(1);
  });
});
