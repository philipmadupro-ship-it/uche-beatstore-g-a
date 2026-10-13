/**
 * GET /api/org/[orgId]/legal/queue (LABEL-31), through the REAL
 * lib/auth/org-access, legal-queue(-store), approvals and member identity,
 * against an in-memory database that evaluates filters. Legal readiness is
 * LABEL-29's; here it is a dial per subject, so "blockers, never the score" is
 * what is proven.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1 Nova's project: songs S1, S3, release R1.
 *     LP2 Kilo's Inbox: song S2.
 *     Members: OWN (owner), LG (legal), LGK (legal, scoped to Kilo), AR (A&R: no
 *     legal ability), PRD (producer). EDITOR: external editor of LP1.
 *   L2: owner X.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const LG = u(2);
const LGK = u(3);
const AR = u(4);
const PRD = u(5);
const EDITOR = u(11);
const X = u(16);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const S3 = t(3);
const R1 = '60000000-0000-4000-8000-000000000001';
const R2 = '60000000-0000-4000-8000-000000000002';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let readiness: Record<string, { ready: boolean; blockers: number; codes: string[] }> = {};

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/labelos/approvals-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/labelos/approvals-store')>()),
  legalGateReadiness: async (_a: unknown, _o: string, subject: { id: string }) => readiness[subject.id] ?? { ready: false, blockers: 9, codes: [] },
}));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const track = (id: string, title: string) => ({ id, org_id: L, user_id: null, type: 'song', title, song_stage: 'selected' });
let n = 0;
const request = (over: Record<string, unknown>) => ({
  id: t(500 + n++), org_id: L, song_id: null, release_id: null, gate: 'legal', decision: 'requested', note: 'please look', actor_id: AR, approver_id: LG, request_id: null, subject_snapshot: {}, created_at: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  n = 0;
  readiness = {
    [S1]: { ready: false, blockers: 3, codes: ['L1', 'L2', 'L5'] },
    [S2]: { ready: true, blockers: 0, codes: [] },
    [S3]: { ready: false, blockers: 1, codes: ['L7'] },
    [R1]: { ready: false, blockers: 2, codes: ['L7'] },
    [R2]: { ready: true, blockers: 0, codes: [] },
  };
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(LG, 'member', ['legal']),
        member(LGK, 'member', ['legal'], 'artists'),
        member(AR, 'member', ['a_and_r']),
        member(PRD, 'member', ['producer']),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: LGK, contact_id: C2 }],
      project_members: [{ org_id: L, project_id: LP1, user_id: EDITOR, role: 'editor', allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: S3, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
      ],
      tracks: [track(S1, 'Midnight'), track(S2, 'Dawn'), track(S3, 'Dusk')],
      releases: [
        { id: R1, org_id: L, project_id: LP1, contact_id: C1, title: 'Nova EP', type: 'ep', state: 'draft', upc: null, label_name: null, c_line: null, p_line: null, primary_genre: null, target_date: null, release_date: null, artwork_asset_id: null },
        { id: R2, org_id: L, project_id: LP1, contact_id: C1, title: 'Cancelled EP', type: 'ep', state: 'cancelled', upc: null, label_name: null, c_line: null, p_line: null, primary_genre: null, target_date: null, release_date: null, artwork_asset_id: null },
      ],
      release_items: [],
      approvals: [
        request({ song_id: S1, created_at: '2026-10-01T00:00:00Z' }),
        request({ song_id: S2, created_at: '2026-10-05T00:00:00Z', approver_id: LGK }),
        request({ release_id: R1, created_at: '2026-10-02T00:00:00Z' }),
        // S3 was asked and approved: not in the queue. A later request would re-open it.
        request({ song_id: S3, created_at: '2026-09-01T00:00:00Z' }),
        { ...request({ song_id: S3, decision: 'approved', approver_id: null, request_id: null, actor_id: LG, created_at: '2026-09-02T00:00:00Z' }) },
        // A cancelled release is not going out.
        request({ release_id: R2, created_at: '2026-10-03T00:00:00Z' }),
        // Another gate's request is not legal's.
        request({ song_id: S3, gate: 'master', created_at: '2026-10-04T00:00:00Z' }),
      ],
      user_profiles: [{ user_id: AR, display_name: 'Ari A&R' }, { user_id: LG, display_name: 'Lena Legal' }],
    },
    unique: {},
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function get(as: string | null, org = L) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/legal/queue`), { params: Promise.resolve({ orgId: org }) });
}
type Body = { schemaReady: boolean; items: { kind: string; id: string; title: string; artist: { name: string } | null; requestedBy: string | null; askedOfMe: boolean; ready: boolean; blockers: number }[]; restricted: number; truncated: boolean };

describe('the queue', () => {
  it('lists open legal requests: ready first, then fewer blockers, then oldest — never by a percentage', async () => {
    const body = (await (await get(LG)).json()) as Body;
    expect(body.schemaReady).toBe(true);
    expect(body.items.map((i) => `${i.kind}:${i.title}`)).toEqual(['song:Dawn', 'release:Nova EP', 'song:Midnight']);
    expect(body.items.map((i) => i.blockers)).toEqual([0, 2, 3]);
    expect(body.items[0].ready).toBe(true);
    expect(body.items[0].artist?.name).toBe('Kilo');
    expect(body.items[1].artist?.name).toBe('Nova');
    expect(JSON.stringify(body)).not.toMatch(/score|please look|subject_snapshot|ipi|legal_name/i);
  });

  it('leaves out an approved gate, a cancelled release and other gates', async () => {
    const body = (await (await get(OWN)).json()) as Body;
    const ids = body.items.map((i) => i.id);
    expect(ids).not.toContain(S3);
    expect(ids).not.toContain(R2);
    expect(body.items).toHaveLength(3);
  });

  it('a request made after an approval re-opens the gate and is listed', async () => {
    db.tables.approvals.push(request({ song_id: S3, created_at: '2026-10-06T00:00:00Z' }));
    const body = (await (await get(LG)).json()) as Body;
    expect(body.items.map((i) => i.id)).toContain(S3);
  });

  it('says who asked and whether it was the viewer who was asked, by name only', async () => {
    const body = (await (await get(LG)).json()) as Body;
    const mine = body.items.find((i) => i.title === 'Midnight')!;
    expect(mine.requestedBy).toBe('Ari A&R');
    expect(mine.askedOfMe).toBe(true);
    expect(body.items.find((i) => i.title === 'Dawn')!.askedOfMe).toBe(false);
  });

  it('a member limited to Kilo sees only Kilo’s song; the rest is a count, never a title', async () => {
    const body = (await (await get(LGK)).json()) as Body;
    expect(body.items.map((i) => i.title)).toEqual(['Dawn']);
    expect(body.restricted).toBe(2);
    expect(JSON.stringify(body)).not.toMatch(/Midnight|Nova/);
  });

  it('ties between equal subjects never reorder between calls', async () => {
    readiness[S1] = { ready: false, blockers: 2, codes: [] };
    db.tables.approvals.find((a) => a.song_id === S1)!.created_at = '2026-10-02T00:00:00Z';
    const a = ((await (await get(LG)).json()) as Body).items.map((i) => i.id);
    const b = ((await (await get(LG)).json()) as Body).items.map((i) => i.id);
    expect(a).toEqual(b);
  });
});

describe('who may open it', () => {
  it('needs the legal gate or contracts: A&R and a producer are 403', async () => {
    expect((await get(AR)).status).toBe(403);
    expect((await get(PRD)).status).toBe(403);
  });
  it('signed out is 401; another org’s owner and an external member get nothing', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(X)).status).toBe(403);
    expect([403, 404]).toContain((await get(EDITOR)).status);
  });
});
