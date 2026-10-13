/**
 * LABEL-41: `requireConnectedTrack` / `requireConnectedProject` /
 * `requireConnectionOfLabel` — the connection scope of org-access, against the
 * real helper code on an in-memory database. Every refusal is a 404 (never a
 * 403: what the artist org holds is not the caller's to learn), 401 only
 * without a session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { requireConnectedProject, requireConnectedTrack, requireConnectionOfLabel } from './org-access';

const id = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LAB = id('1', 1);
const ART = id('1', 2);
const ART2 = id('1', 3);
const PRODUCER_ORG = id('1', 4);
const OWNER = id('2', 1);
const AR = id('2', 2);
const MK = id('2', 3);
const LTD = id('2', 4);
const ART_OWNER = id('2', 5);
const NOBODY = id('2', 6);
const C = id('3', 1);
const C_OTHER = id('3', 2);
const P1 = id('4', 1);
const P2 = id('4', 2);
const PX = id('4', 3);
const PROD_P = id('4', 4);
const T1 = id('5', 1);
const T2 = id('5', 2);
const TX = id('5', 3);
const T_PROD = id('5', 4);
const T_LOOSE = id('5', 5);
const CONN = id('6', 1);

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const m = (org: string, user: string, role: string, functions: string[] = [], scope = 'org') => ({
  org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [],
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [
        { id: LAB, kind: 'label', deleted_at: null },
        { id: ART, kind: 'artist', deleted_at: null },
        { id: ART2, kind: 'artist', deleted_at: null },
        { id: PRODUCER_ORG, kind: 'producer', deleted_at: null },
      ],
      org_members: [
        m(LAB, OWNER, 'owner'),
        m(LAB, AR, 'member', ['a_and_r']),
        m(LAB, MK, 'member', ['marketing']),
        m(LAB, LTD, 'member', ['a_and_r'], 'artists'),
        m(ART, ART_OWNER, 'owner'),
      ],
      member_artist_scopes: [{ org_id: LAB, user_id: LTD, contact_id: C_OTHER }],
      org_connections: [
        { id: CONN, label_org_id: LAB, artist_org_id: ART, status: 'active', initiated_by: 'label', label_contact_id: C, share_mode: 'selected', allow_copies: false, accepted_at: '2026-10-01', ended_at: null, created_at: '2026-10-01' },
      ],
      connection_projects: [{ connection_id: CONN, project_id: P1, org_id: ART }],
      projects: [
        { id: P1, org_id: ART, user_id: null },
        { id: P2, org_id: ART, user_id: null },
        { id: PX, org_id: ART2, user_id: null },
        { id: PROD_P, org_id: null, user_id: OWNER },
      ],
      project_tracks: [
        { project_id: P1, track_id: T1 },
        { project_id: P2, track_id: T2 },
        { project_id: P1, track_id: T_LOOSE },
        { project_id: P2, track_id: T_LOOSE },
        { project_id: PX, track_id: TX },
        { project_id: PROD_P, track_id: T_PROD },
      ],
      tracks: [
        { id: T1, org_id: ART }, { id: T2, org_id: ART }, { id: TX, org_id: ART2 }, { id: T_PROD, org_id: null, user_id: OWNER }, { id: T_LOOSE, org_id: ART },
      ],
    },
  };
  mem = memoryAdmin(db);
});

const track = (user: string | null, trackId = T1, orgId = LAB) => {
  current = user;
  return requireConnectedTrack({ trackId, orgId, cap: 'catalog.read' });
};
const project = (user: string | null, projectId = P1, orgId = LAB) => {
  current = user;
  return requireConnectedProject({ projectId, orgId, cap: 'catalog.read' });
};
const conn = (user: string | null, connectionId = CONN, orgId = LAB) => {
  current = user;
  return requireConnectionOfLabel({ orgId, connectionId, cap: 'catalog.read' });
};
const status = (r: Awaited<ReturnType<typeof track>>) => (r.ok ? 200 : r.res.status);

describe('requireConnectedTrack', () => {
  it('admits a label member to a recording in a shared project, as the LABEL member with the LABEL’s org id', async () => {
    const r = await track(AR);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.orgId).toBe(LAB);
      expect(r.sourceOrgId).toBe(ART);
      expect(r.connection.id).toBe(CONN);
      expect(r.orgKind).toBe('label');
      expect(r.capabilities.has('audio.working')).toBe(true);
    }
  });

  it('keeps the member’s OWN capabilities: marketing is admitted but holds no working audio', async () => {
    const r = await track(MK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.capabilities.has('audio.finished')).toBe(true);
      expect(r.capabilities.has('audio.working')).toBe(false);
    }
  });

  it('refuses everything else with the same 404', async () => {
    expect(status(await track(AR, T2))).toBe(404); // artist org, project not shared
    expect(status(await track(AR, TX))).toBe(404); // another artist org
    expect(status(await track(AR, T_PROD))).toBe(404); // a producer track
    expect(status(await track(AR, id('5', 99)))).toBe(404); // missing
    expect(status(await track(AR, 'not-a-uuid'))).toBe(404);
    expect(status(await track(LTD))).toBe(404); // limited to another roster artist
    expect(status(await track(ART_OWNER))).toBe(404); // the artist side holds no label membership
    expect(status(await track(ART_OWNER, T1, ART))).toBe(404); // and the artist org is not a label
    expect(status(await track(NOBODY))).toBe(404);
    expect(status(await track(AR, T1, ART2))).toBe(404); // naming the wrong org
    expect(status(await track(null))).toBe(401);
  });

  it('a track in several projects is reached through any shared one', async () => {
    expect(status(await track(AR, T_LOOSE))).toBe(200); // in P1 (shared) and P2 (not)
    db.tables.connection_projects = [];
    expect(status(await track(AR, T_LOOSE))).toBe(404);
  });

  it('a limited member whose scope names the connection’s roster artist is admitted', async () => {
    db.tables.member_artist_scopes.push({ org_id: LAB, user_id: LTD, contact_id: C });
    expect(status(await track(LTD))).toBe(200);
  });

  it('share mode all reaches every project of the artist org, and still no other org’s', async () => {
    db.tables.org_connections[0].share_mode = 'all';
    expect(status(await track(AR, T2))).toBe(200);
    expect(status(await track(AR, TX))).toBe(404);
  });

  it('only an ACTIVE connection with live orgs on both sides', async () => {
    for (const s of ['requested', 'declined', 'ended']) {
      db.tables.org_connections[0].status = s;
      expect(status(await track(AR)), s).toBe(404);
    }
    db.tables.org_connections[0].status = 'active';
    expect(status(await track(AR))).toBe(200);
    db.tables.organizations.find((o) => o.id === ART)!.deleted_at = '2026-10-10';
    expect(status(await track(AR))).toBe(404);
    db.tables.organizations.find((o) => o.id === ART)!.deleted_at = null;
    db.tables.organizations.find((o) => o.id === LAB)!.deleted_at = '2026-10-10';
    expect(status(await track(AR))).toBe(404);
  });

  it('a connection for a different PAIR grants nothing (the label must be the connection’s label)', async () => {
    db.tables.org_connections[0].label_org_id = PRODUCER_ORG;
    expect(status(await track(AR))).toBe(404);
  });

  it('fails closed (500, never admitted) when a read fails', async () => {
    const real = mem.client.from;
    mem.client.from = ((t: string) => {
      if (t === 'org_connections') throw new Error('boom');
      return real(t);
    }) as typeof mem.client.from;
    expect(status(await track(AR))).toBe(500);
    mem.client.from = real;
  });

  it('before migration 154 there is no connection table: a 404, not a 500', async () => {
    const real = mem.client.from;
    mem.client.from = ((t: string) => {
      if (t !== 'org_connections') return real(t);
      const q = real('organizations') as unknown as Record<string, unknown>;
      const chain: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'in', 'is']) chain[k] = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: { message: "Could not find the table 'public.org_connections' in the schema cache", code: 'PGRST205' } });
      void q;
      return chain;
    }) as unknown as typeof mem.client.from;
    expect(status(await track(AR))).toBe(404);
  });
});

describe('requireConnectedProject', () => {
  it('admits the shared project and no other', async () => {
    expect(status(await project(AR))).toBe(200);
    expect(status(await project(AR, P2))).toBe(404);
    expect(status(await project(AR, PX))).toBe(404);
    expect(status(await project(AR, PROD_P))).toBe(404);
    expect(status(await project(LTD))).toBe(404);
    expect(status(await project(ART_OWNER, P1, ART))).toBe(404);
    expect(status(await project(null))).toBe(401);
  });
});

describe('requireConnectionOfLabel', () => {
  it('the label’s own active connection, for a member in scope with catalog.read', async () => {
    const r = await conn(AR);
    expect(r.ok && r.sourceOrgId).toBe(ART);
    expect(status(await conn(MK))).toBe(200);
  });

  it('403 for a non-member of the route’s org, 404 for everything else', async () => {
    expect(status(await conn(NOBODY))).toBe(403);
    expect(status(await conn(ART_OWNER))).toBe(403);
    expect(status(await conn(AR, CONN, ART2))).toBe(403);
    expect(status(await conn(AR, id('6', 9)))).toBe(404);
    expect(status(await conn(AR, 'nope'))).toBe(404);
    expect(status(await conn(LTD))).toBe(404);
    expect(status(await conn(null))).toBe(401);
    db.tables.org_connections[0].status = 'ended';
    expect(status(await conn(AR))).toBe(404);
  });

  it('another label’s connection id, named under this label’s path, is a 404', async () => {
    db.tables.org_connections[0].label_org_id = PRODUCER_ORG;
    expect(status(await conn(AR))).toBe(404);
  });
});
