/**
 * The project members routes (LABEL-21): invite, list, change, remove and
 * revoke — through the REAL lib/auth/org-access (membership, capability,
 * artist scope) and the real route code on an in-memory database. Mail and
 * the rate limiter are faked; migration 148's functions are the in-memory
 * stand-in (`auditRpcMemory`), whose real transactions are proven against
 * Postgres in supabase/local/checks/148_labelos_project_members.sql.
 *
 * Who may: `share.external` on THE PROJECT — owner, admin, A&R, project
 * manager; not marketing; an artists-scoped member only on their artist's
 * projects; an external member (even an editor) never.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';
import { hashInvitationToken } from '@/lib/labelos/invitations';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = u(1);
const AR = u(2);
const MKT = u(3);
const SC = u(4);
const EXT = u(5);
const VIEW = u(6);
const NEWBIE = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const P1 = '40000000-0000-4000-8000-0000000000a1';
const P2 = '40000000-0000-4000-8000-0000000000a2';
const XP = '40000000-0000-4000-8000-0000000000b1';
const PRODUCER_P = '40000000-0000-4000-8000-0000000000c1';
const INV_OLD = '80000000-0000-4000-8000-000000000001';
const INV_ORG = '80000000-0000-4000-8000-000000000002';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let auditFails = false;
let rateOk = true;
const emails: Record<string, unknown>[] = [];
let emailResult: { sent: boolean; reason?: string } = { sent: true };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => rateOk }));
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://app.test' }));
vi.mock('@/lib/labelos/invitation-email', () => ({
  inviterDisplayName: async () => 'Dana',
  sendProjectInvitationEmail: async (opts: Record<string, unknown>) => {
    emails.push(opts);
    return emailResult;
  },
}));

const member = (user: string, role: string, functions: string[] = [], scope = 'org') => ({
  org_id: L, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [],
});
const pm = (user: string, role: string, project = P1, org = L, extra: Record<string, unknown> = {}) => ({
  org_id: org, project_id: project, user_id: user, role, allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01', ...extra,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  auditFails = false;
  rateOk = true;
  emails.length = 0;
  emailResult = { sent: true };
  db = {
    tables: {
      organizations: [
        { id: L, name: 'Night Shift', kind: 'label', deleted_at: null },
        { id: L2, name: 'Other', kind: 'label', deleted_at: null },
      ],
      org_members: [
        member(OWNER, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(SC, 'member', ['a_and_r'], 'artists'),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo' },
      ],
      projects: [
        { id: P1, org_id: L, user_id: null, name: 'Uche × Producer X', inbox_for_contact_id: C1 },
        { id: P2, org_id: L, user_id: null, name: 'Kilo LP', inbox_for_contact_id: C2 },
        { id: XP, org_id: L2, user_id: null, name: 'Elsewhere', inbox_for_contact_id: null },
        { id: PRODUCER_P, org_id: null, user_id: OWNER, name: 'Producer project', inbox_for_contact_id: null },
      ],
      project_contacts: [],
      project_members: [
        pm(EXT, 'editor', P1, L, { invitation_id: INV_OLD }),
        pm(VIEW, 'viewer', P1),
      ],
      org_invitations: [
        { id: INV_OLD, org_id: L, email: 'ext@local.test', role: 'member', project_id: P1, project_role: 'editor', project_allow_downloads: false, token_hash: 'x', expires_at: '2099-01-01', accepted_at: '2026-10-01', revoked_at: null, created_at: '2026-09-30' },
      ],
      user_profiles: [{ user_id: EXT, display_name: 'Producer X' }],
      creator_profiles: [],
      activity_events: [],
    },
    rpc: auditRpcMemory({ failAudit: () => auditFails }),
  };
  mem = memoryAdmin(db);
});

type Ctx = { params: Promise<Record<string, string>> };
/** A JSON body, read loosely: the assertions name the keys they care about. */
type Json = Record<string, unknown> & { members?: unknown[]; invitations?: unknown[]; invitation?: { id?: unknown } };
async function route<T extends Record<string, unknown>>(file: string, method: string, params: T, init: { body?: unknown } = {}) {
  const mod = (await import(file)) as Record<string, (req: NextRequest, ctx: Ctx) => Promise<Response>>;
  const hasBody = init.body !== undefined;
  const req = new NextRequest('https://app.test/x', {
    method,
    ...(hasBody ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
  });
  const res = await mod[method](req, { params: Promise.resolve(params as Record<string, string>) });
  return { status: res.status, json: (await res.json().catch(() => null)) as Json | null };
}
const members = (method: string, user: string, project = P1, body?: unknown, org = L) => {
  current = user;
  return route('./route', method, { orgId: org, id: project }, { body });
};
const one = (method: string, user: string, target: string, body?: unknown, project = P1) => {
  current = user;
  return route('./[userId]/route', method, { orgId: L, id: project, userId: target }, { body });
};
const revoke = (user: string, invitationId: string, project = P1) => {
  current = user;
  return route('../invitations/[invitationId]/route', 'DELETE', { orgId: L, id: project, invitationId });
};
const invite = (user: string, body: Record<string, unknown> = {}, project = P1) =>
  members('POST', user, project, { email: ' Guest@Local.Test ', role: 'contributor', ...body });
const eventsOf = (verb: string) => db.tables.activity_events.filter((e) => e.verb === verb);

describe('who may manage external members', () => {
  it('owner, A&R and an artists-scoped A&R on their own artist’s project may', async () => {
    for (const user of [OWNER, AR, SC]) {
      db.tables.org_invitations = db.tables.org_invitations.filter((i) => i.id === INV_OLD);
      expect((await invite(user)).status, user).toBe(201);
    }
  });

  it('marketing has no share.external: 403 on every method', async () => {
    expect((await members('GET', MKT)).status).toBe(403);
    expect((await invite(MKT)).status).toBe(403);
    expect((await one('PATCH', MKT, EXT, { role: 'viewer' })).status).toBe(403);
    expect((await one('DELETE', MKT, EXT)).status).toBe(403);
    expect((await revoke(MKT, INV_OLD)).status).toBe(403);
  });

  it('an artists-scoped member cannot reach a project of another artist: 404', async () => {
    expect((await invite(SC, {}, P2)).status).toBe(404);
    expect((await members('GET', SC, P2)).status).toBe(404);
  });

  it('an EXTERNAL member — even an editor — is 404 on all of it', async () => {
    expect((await members('GET', EXT)).status).toBe(404);
    expect((await invite(EXT)).status).toBe(404);
    expect((await one('PATCH', EXT, VIEW, { role: 'editor' })).status).toBe(404);
    expect((await one('DELETE', EXT, VIEW)).status).toBe(404);
    expect((await revoke(EXT, INV_OLD)).status).toBe(404);
    expect(db.tables.project_members.find((m) => m.user_id === VIEW)?.role).toBe('viewer');
  });

  it('another org’s project, a producer project and a missing one are 404', async () => {
    expect((await invite(OWNER, {}, XP)).status).toBe(404);
    expect((await invite(OWNER, {}, PRODUCER_P)).status).toBe(404);
    expect((await invite(OWNER, {}, '40000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await members('GET', AR, P1, undefined, L2)).status).toBe(404);
  });

  it('signed out is 401', async () => {
    current = null;
    expect((await route('./route', 'GET', { orgId: L, id: P1 })).status).toBe(401);
  });
});

describe('POST: invite', () => {
  it('creates a project invitation, audits it, and emails the link — the token only there', async () => {
    const r = await invite(AR, { allow_downloads: false });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ emailSent: true, invitation: { email: 'guest@local.test', role: 'contributor', allow_downloads: false } });
    const row = db.tables.org_invitations.find((i) => i.email === 'guest@local.test')!;
    expect(row).toMatchObject({ org_id: L, project_id: P1, project_role: 'contributor', invited_by: AR });
    expect(eventsOf('invitation.created')).toHaveLength(1);
    expect(eventsOf('invitation.created')[0]).toMatchObject({ org_id: L, actor_id: AR, audit: true, payload: { project_id: P1, project_role: 'contributor' } });

    const mail = emails[0] as { to: string; url: string; projectName: string; roleLabel: string; orgName: string };
    expect(mail).toMatchObject({ to: 'guest@local.test', projectName: 'Uche × Producer X', roleLabel: 'Contributor', orgName: 'Night Shift', inviterName: 'Dana' });
    const token = /\/join\/([A-Za-z0-9_-]{43})$/.exec(mail.url)![1];
    // Stored hashed, never in the clear, the response or the audit event.
    expect(row.token_hash).toBe(hashInvitationToken(token));
    expect(JSON.stringify(r.json)).not.toContain(token);
    expect(JSON.stringify(db.tables.activity_events)).not.toContain(token);
  });

  it('reports a failed email without failing the invitation', async () => {
    emailResult = { sent: false, reason: 'not_configured' };
    const r = await invite(AR);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ emailSent: false, emailError: 'not_configured' });
  });

  it.each([
    ['owner', { role: 'owner' }],
    ['admin', { role: 'admin' }],
    ['an unknown role', { role: 'boss' }],
    ['a bad address', { email: 'nope' }],
  ])('400 for %s', async (_label, over) => {
    expect((await invite(AR, over)).status).toBe(400);
    expect(db.tables.org_invitations).toHaveLength(1);
  });

  it('400 on an unknown key (org_id, user_id … are never accepted)', async () => {
    expect((await invite(AR, { org_id: L2 })).status).toBe(400);
    expect((await invite(AR, { project_id: P2 })).status).toBe(400);
  });

  it('409 for a second pending invitation to the same address and project; another project is fine', async () => {
    expect((await invite(AR)).status).toBe(201);
    const again = await invite(AR, { email: 'GUEST@local.test' });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ invitationId: expect.any(String) });
    expect((await invite(AR, {}, P2)).status).toBe(201);
  });

  it('429 when rate-limited, and nothing is written', async () => {
    rateOk = false;
    expect((await invite(AR)).status).toBe(429);
    expect(db.tables.org_invitations).toHaveLength(1);
  });

  it('a failed audit insert rolls the invitation back: 500, no row, no email', async () => {
    auditFails = true;
    expect((await invite(AR)).status).toBe(500);
    expect(db.tables.org_invitations).toHaveLength(1);
    expect(emails).toEqual([]);
  });

  it('503 naming migration 148 when its functions are not applied', async () => {
    db.rpc = {};
    const r = await invite(AR);
    expect(r.status).toBe(503);
    expect(String(r.json?.error)).toContain('148');
  });
});

describe('GET: the members and pending invitations', () => {
  it('names each member and the address they were invited at; never a token or hash', async () => {
    await invite(AR);
    const r = await members('GET', AR);
    expect(r.status).toBe(200);
    const byUser = Object.fromEntries((r.json!.members as { user_id: string }[]).map((m) => [m.user_id, m]));
    expect(byUser[EXT]).toMatchObject({ name: 'Producer X', email: 'ext@local.test', role: 'editor', live: true, summary: expect.stringContaining('edits metadata') });
    expect(byUser[VIEW]).toMatchObject({ role: 'viewer', allow_downloads: false, email: null });
    expect(r.json!.invitations).toEqual([
      expect.objectContaining({ email: 'guest@local.test', role: 'contributor', allow_downloads: false }),
    ]);
    const text = JSON.stringify(r.json);
    expect(text).not.toContain('token_hash');
    expect(text).not.toMatch(/"x"/);
  });

  it('lists only THIS project’s members', async () => {
    db.tables.project_members.push(pm(NEWBIE, 'viewer', P2));
    const ids = ((await members('GET', AR)).json!.members as { user_id: string }[]).map((m) => m.user_id).sort();
    expect(ids).toEqual([EXT, VIEW].sort());
  });

  it('an empty panel that says migration 148 is missing, not a 500', async () => {
    delete (db.tables as Record<string, unknown>).project_members;
    // memory-db answers an unknown table with no rows; ask for the table error the way PostgREST does.
    const orig = mem.client.from;
    mem.client.from = ((t: string) => {
      if (t !== 'project_members') return orig(t);
      const err = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.project_members' in the schema cache" } };
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'in', 'order']) b[k] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(err).then(resolve);
      return b;
    }) as typeof mem.client.from;
    const r = await members('GET', AR);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ members: [], schemaReady: false });
  });
});

describe('PATCH: change a member', () => {
  it('changes the role, audits it with from/to, and the member’s next request sees it', async () => {
    const r = await one('PATCH', AR, VIEW, { role: 'commenter', allow_downloads: true });
    expect(r.status).toBe(200);
    expect(db.tables.project_members.find((m) => m.user_id === VIEW)).toMatchObject({ role: 'commenter', allow_downloads: true });
    expect(eventsOf('project.member_changed')).toHaveLength(1);
    expect(eventsOf('project.member_changed')[0]).toMatchObject({
      actor_id: AR,
      subject_id: VIEW,
      audit: true,
      payload: { project_id: P1, changes: { role: { from: 'viewer', to: 'commenter' }, allow_downloads: { from: false, to: true } } },
    });
  });

  it('400 for nothing to change, an unknown role, a past expiry and an empty body', async () => {
    expect((await one('PATCH', AR, VIEW, { role: 'viewer' })).status).toBe(400);
    expect((await one('PATCH', AR, VIEW, { role: 'owner' })).status).toBe(400);
    expect((await one('PATCH', AR, VIEW, { expires_at: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect((await one('PATCH', AR, VIEW, {})).status).toBe(400);
    expect(eventsOf('project.member_changed')).toEqual([]);
  });

  it('404 for someone who is not a member of THIS project, or a malformed id', async () => {
    expect((await one('PATCH', AR, NEWBIE, { role: 'viewer' })).status).toBe(404);
    db.tables.project_members.push(pm(NEWBIE, 'viewer', P2));
    expect((await one('PATCH', AR, NEWBIE, { role: 'editor' })).status).toBe(404);
    expect((await one('PATCH', AR, 'nope', { role: 'editor' })).status).toBe(404);
    expect(db.tables.project_members.find((m) => m.user_id === NEWBIE)?.role).toBe('viewer');
  });

  it('a failed audit insert changes nothing', async () => {
    auditFails = true;
    expect((await one('PATCH', AR, VIEW, { role: 'editor' })).status).toBe(500);
    expect(db.tables.project_members.find((m) => m.user_id === VIEW)?.role).toBe('viewer');
  });
});

describe('DELETE: remove a member', () => {
  it('removes them with an audit event; their very next request is refused; their upload stays', async () => {
    db.tables.tracks = [{ id: 'trk', org_id: L, user_id: null, created_by: EXT, title: 'v2', type: 'song' }];
    db.tables.project_tracks = [{ project_id: P1, track_id: 'trk', position: 0 }];
    const r = await one('DELETE', AR, EXT);
    expect(r.status).toBe(200);
    expect(db.tables.project_members.find((m) => m.user_id === EXT)).toBeUndefined();
    expect(eventsOf('project.member_removed')).toHaveLength(1);
    expect(eventsOf('project.member_removed')[0]).toMatchObject({ actor_id: AR, subject_id: EXT, audit: true, payload: { project_id: P1, role: 'editor' } });
    // D3: the upload is still in the project, credited to them.
    expect(db.tables.tracks[0]).toMatchObject({ created_by: EXT });
    expect(db.tables.project_tracks).toHaveLength(1);
    // And they are out: the project's own route no longer knows them.
    current = EXT;
    const mod = await import('../route');
    const res = await mod.GET(new NextRequest('https://app.test/x'), { params: Promise.resolve({ orgId: L, id: P1 }) });
    expect(res.status).toBe(404);
  });

  it('404 the second time', async () => {
    expect((await one('DELETE', AR, EXT)).status).toBe(200);
    expect((await one('DELETE', AR, EXT)).status).toBe(404);
  });

  it('a failed audit insert removes nobody', async () => {
    auditFails = true;
    expect((await one('DELETE', AR, EXT)).status).toBe(500);
    expect(db.tables.project_members.find((m) => m.user_id === EXT)).toBeDefined();
  });
});

describe('DELETE: revoke a pending project invitation', () => {
  it('revokes it with an event, idempotently', async () => {
    const created = await invite(AR);
    const id = created.json!.invitation!.id as string;
    const r = await revoke(AR, id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ revoked: true });
    expect(eventsOf('invitation.revoked')).toHaveLength(1);
    expect((await revoke(AR, id)).status).toBe(200);
    expect(eventsOf('invitation.revoked')).toHaveLength(1);
  });

  it('an accepted one is 409 (remove the member instead)', async () => {
    expect((await revoke(AR, INV_OLD)).status).toBe(409);
  });

  it('another project’s invitation, an org invitation or a missing one is 404', async () => {
    const created = await invite(AR, {}, P2);
    expect((await revoke(AR, created.json!.invitation!.id as string, P1)).status).toBe(404);
    db.tables.org_invitations.push({ id: INV_ORG, org_id: L, email: 'o@local.test', role: 'member', project_id: null, project_role: null, token_hash: 'y', expires_at: '2099-01-01', accepted_at: null, revoked_at: null, created_at: 'now' });
    expect((await revoke(AR, INV_ORG)).status).toBe(404);
    expect((await revoke(AR, '80000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await revoke(AR, 'not-a-uuid')).status).toBe(404);
  });
});
