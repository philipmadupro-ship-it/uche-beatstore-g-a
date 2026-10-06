/**
 * LABEL-21's route matrix: an EXTERNAL project member (a `project_members`
 * row, no `org_members` row) against EVERY handler under src/app/api/org.
 * Each runs through the REAL lib/auth/org-access and the real route code
 * against an in-memory database; only storage, mail and the rate limiter are
 * faked, and none of them is reached before authorisation.
 *
 * The property: an external member reaches artist, org and other-project
 * objects NOWHERE. Every handler that is not in the allowlist
 * (lib/labelos/external-routes) must answer them 403 or 404 — for each of the
 * four project roles, with the member's own project's ids in every path
 * param (the worst case: they hold a real id in the real org). A route
 * added later is walked automatically: it either refuses them or must be
 * named in the allowlist, with a reason.
 *
 * Then the allowlisted routes: what a role may do, and that revoking or
 * expiring a membership ends it on the very next request.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';
import { EXTERNAL_ROUTES, externalRouteKeys } from '@/lib/labelos/external-routes';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = u(1);
const VIEWER = u(11);
const COMMENTER = u(12);
const CONTRIBUTOR = u(13);
const EDITOR = u(14);
const STRANGER = u(15);
const OTHER = u(16);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const P1 = '40000000-0000-4000-8000-0000000000a1';
const P2 = '40000000-0000-4000-8000-0000000000a2';
const XP = '40000000-0000-4000-8000-0000000000b1';
const k = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = k(1); // a song in P1
const S2 = k(2); // a song in P2 (same org, not shared with them)
const XS = k(3); // a song in another org
const ASSET = '60000000-0000-4000-8000-000000000001';
const RELEASE = '70000000-0000-4000-8000-000000000001';
const ITEM = '70000000-0000-4000-8000-000000000002';
const INV = '80000000-0000-4000-8000-000000000001';
const COMMENT = '90000000-0000-4000-8000-000000000001'; // artist-visible
const INTERNAL = '90000000-0000-4000-8000-000000000002'; // team-only

const ROLES = { viewer: VIEWER, commenter: COMMENTER, contributor: CONTRIBUTOR, editor: EDITOR } as const;

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '127.0.0.1', rateLimit: () => true }));

function seed(): MemoryDb {
  const member = (user: string, role: string, project = P1, org = L, extra: Record<string, unknown> = {}) => ({
    org_id: org, project_id: project, user_id: user, role, allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01', ...extra,
  });
  return {
    tables: {
      organizations: [
        { id: L, name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: null },
        { id: L2, name: 'Other Label', slug: 'other', kind: 'label', deleted_at: null },
      ],
      org_members: [{ org_id: L, user_id: OWNER, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] }],
      project_members: [
        member(VIEWER, 'viewer'),
        member(COMMENTER, 'commenter'),
        member(CONTRIBUTOR, 'contributor'),
        member(EDITOR, 'editor'),
        member(OTHER, 'editor', XP, L2),
      ],
      contacts: [{ id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' }],
      projects: [
        { id: P1, org_id: L, user_id: null, name: 'Uche × Producer X', inbox_for_contact_id: C1 },
        { id: P2, org_id: L, user_id: null, name: 'Secret LP', inbox_for_contact_id: null },
        { id: XP, org_id: L2, user_id: null, name: 'Elsewhere', inbox_for_contact_id: null },
      ],
      project_contacts: [],
      project_tracks: [
        { project_id: P1, track_id: S1, position: 0 },
        { project_id: P2, track_id: S2, position: 0 },
        { project_id: XP, track_id: XS, position: 0 },
      ],
      tracks: [
        { id: S1, org_id: L, user_id: null, created_by: OWNER, title: 'Midnight', type: 'song', song_stage: 'in_review', audio_url: 'r2://priv/s1.mp3', wav_url: null, preview_url: null, peaks_url: null },
        { id: S2, org_id: L, user_id: null, created_by: OWNER, title: 'Secret', type: 'song', song_stage: 'in_review', audio_url: 'r2://priv/s2.mp3', wav_url: null, preview_url: null, peaks_url: null },
        { id: XS, org_id: L2, user_id: null, created_by: OTHER, title: 'Elsewhere', type: 'song', song_stage: 'in_review', audio_url: 'r2://priv/xs.mp3', wav_url: null, preview_url: null, peaks_url: null },
      ],
      project_assets: [{ id: ASSET, org_id: L, project_id: P1, user_id: null, kind: 'artwork', sensitivity: 'normal', label: 'Cover', url: 'r2://priv/cover.png', file_name: 'cover.png' }],
      project_comments: [
        { id: COMMENT, org_id: L, project_id: P1, track_id: S1, user_id: OWNER, author_name: 'Owen', body: 'Open note', parent_id: null, region_start: null, region_end: null, visibility: 'artist', resolved_at: null, deleted_at: null, share_token: null, contact_id: null, created_at: '2026-10-01T10:00:00Z' },
        { id: INTERNAL, org_id: L, project_id: P1, track_id: S1, user_id: OWNER, author_name: 'Owen', body: 'Team-only note', parent_id: null, region_start: null, region_end: null, visibility: 'internal', resolved_at: null, deleted_at: null, share_token: null, contact_id: null, created_at: '2026-10-01T11:00:00Z' },
      ],
      org_invitations: [
        { id: INV, org_id: L, email: 'x@local.test', role: 'member', functions: [], artist_ids: [], project_id: P1, project_role: 'viewer', token_hash: 'h', expires_at: '2099-01-01', accepted_at: null, revoked_at: null, created_at: '2026-10-01' },
      ],
      releases: [{ id: RELEASE, org_id: L, project_id: P1, contact_id: C1, state: 'planned', title: 'EP' }],
      release_items: [{ id: ITEM, org_id: L, release_id: RELEASE, position: 1, song_track_id: S1 }],
      activity_events: [],
      user_profiles: [],
      creator_profiles: [],
      track_links: [],
      song_beats: [],
      stems: [],
    },
    rpc: auditRpcMemory(),
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  process.env.R2_PRIVATE_BUCKET_NAME = 'priv';
  current = null;
  db = seed();
  mem = memoryAdmin(db);
});

// ── Every route file, and every handler it exports ──────────────────────

const ROOT = __dirname;
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}
const HTTP = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const files = routeFiles(ROOT).map((full) => relative(ROOT, full).split(sep).join('/')).sort();
const loaders = import.meta.glob('./**/route.ts') as Record<string, () => Promise<Record<string, unknown>>>;

function handlersOf(path: string): string[] {
  const src = readFileSync(join(ROOT, path), 'utf8');
  return HTTP.filter((m) => new RegExp(`^export\\s+(?:async\\s+function\\s+${m}\\b|const\\s+${m}\\s*=)`, 'm').test(src));
}

/** Path params for a route, with the external member's OWN project in every project slot. */
function paramsFor(path: string): Record<string, string> {
  const names = [...path.matchAll(/\[(\w+)\]/g)].map((m) => m[1]);
  const values: Record<string, string> = {
    orgId: L,
    id: P1,
    trackId: S1,
    contactId: C1,
    assetId: ASSET,
    releaseId: RELEASE,
    itemId: ITEM,
    invitationId: INV,
    commentId: COMMENT,
    userId: EDITOR,
  };
  return Object.fromEntries(names.map((n) => [n, values[n] ?? P1]));
}

function urlFor(path: string, params: Record<string, string>): string {
  const route = path.replace(/\/?route\.ts$/, '').replace(/\[(\w+)\]/g, (_, n: string) => params[n]);
  return `https://app.test/api/org${route ? `/${route}` : ''}`;
}

async function call(path: string, method: string, user: string | null, init: { body?: unknown; query?: string } = {}) {
  current = user;
  const mod = await loaders[`./${path}`]();
  const handler = mod[method] as (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const params = paramsFor(path);
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';
  const req = new NextRequest(`${urlFor(path, params)}${init.query ?? ''}`, {
    method,
    ...(hasBody ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body ?? {}) } : {}),
  });
  return handler(req, { params: Promise.resolve(params) });
}

describe('the matrix walks every org route', () => {
  it('finds the real routes, and every one of them loads', () => {
    expect(files.length).toBeGreaterThan(25);
    expect(Object.keys(loaders).map((p) => p.replace(/^\.\//, '')).sort()).toEqual(files);
  });

  it('the allowlist names only handlers that exist', () => {
    const real = new Set(files.flatMap((f) => handlersOf(f).map((m) => `${f}:${m}`)));
    expect(externalRouteKeys().filter((key) => !real.has(key))).toEqual([]);
    for (const [path, r] of Object.entries(EXTERNAL_ROUTES)) expect(r.why.length, path).toBeGreaterThan(20);
  });
});

describe('an external member × every org route', () => {
  const allowed = new Set(externalRouteKeys());
  const refused = files.flatMap((f) => handlersOf(f).filter((m) => !allowed.has(`${f}:${m}`)).map((m) => [f, m] as const));

  it('covers a realistic number of refused handlers', () => {
    expect(refused.length).toBeGreaterThan(30);
  });

  for (const [role, user] of Object.entries(ROLES)) {
    for (const [path, method] of refused) {
      it(`${role}: ${method} ${path} → 403/404`, async () => {
        const res = await call(path, method, user);
        expect([403, 404], `${method} ${path} answered ${res.status}`).toContain(res.status);
        // And nothing happened: no row of the org's was written.
        expect(mem.writes.filter((w) => w.op !== 'rpc')).toEqual([]);
      });
    }
  }

  it('a stranger (no membership at all) is refused everywhere the same way', async () => {
    for (const [path, method] of refused) {
      const res = await call(path, method, STRANGER);
      expect([403, 404], `${method} ${path}`).toContain(res.status);
    }
  });

  it('signed out is 401 or the route’s own refusal, never a 200', async () => {
    for (const [path, method] of refused) {
      const res = await call(path, method, null);
      expect([401, 403, 404], `${method} ${path}`).toContain(res.status);
    }
  });
});

describe('the allowlisted routes', () => {
  it('GET /api/org/shared lists only the caller’s own live memberships', async () => {
    const res = await call('shared/route.ts', 'GET', VIEWER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([
      { id: P1, name: 'Uche × Producer X', orgName: 'Night Shift', role: 'viewer', href: `/shared/${P1}` },
    ]);
    // Nothing about the org beyond its name; no ids of it, no slug, no members.
    expect(JSON.stringify(body)).not.toContain(L);
    expect(JSON.stringify(body)).not.toContain('night-shift');
    expect((await (await call('shared/route.ts', 'GET', STRANGER)).json()).projects).toEqual([]);
  });

  it('GET project: the shared view for a member; 404 for any other project, org or id', async () => {
    const res = await call('[orgId]/projects/[id]/route.ts', 'GET', VIEWER);
    expect(res.status).toBe(200);
    const { shared } = await res.json();
    expect(shared.project).toMatchObject({ id: P1, name: 'Uche × Producer X', orgName: 'Night Shift', artistNames: ['Nova'] });
    expect(shared.me).toMatchObject({ role: 'viewer', allowDownloads: false, can: { listen: true, comment: false, uploadVersions: false, editMetadata: false, download: false } });
    expect(shared.recordings.map((r: { id: string }) => r.id)).toEqual([S1]);
    expect(shared.recordings[0].downloadUrl).toBeNull();
    // Built field by field: no stored reference, no ids of artists, no stage, no member ids.
    const text = JSON.stringify(shared);
    for (const leak of ['r2://', C1, 'in_review', OWNER, 'audio_url', 'song_stage']) expect(text, leak).not.toContain(leak);

    current = VIEWER;
    const mod = await loaders['./[orgId]/projects/[id]/route.ts']();
    const get = mod.GET as (req: NextRequest, ctx: { params: Promise<{ orgId: string; id: string }> }) => Promise<Response>;
    const ask = (orgId: string, id: string) => get(new NextRequest(`https://app.test/api/org/${orgId}/projects/${id}`), { params: Promise.resolve({ orgId, id }) });
    expect((await ask(L, P2)).status).toBe(404); // same org, not theirs
    expect((await ask(L, XP)).status).toBe(404); // another org's
    expect((await ask(L2, P1)).status).toBe(404); // right project, wrong org in the path
    expect((await ask(L, 'not-a-uuid')).status).toBe(404);
  });

  it('each role’s controls are exactly the §2.6 table', async () => {
    const can = async (user: string) => (await (await call('[orgId]/projects/[id]/route.ts', 'GET', user)).json()).shared.me.can;
    expect(await can(VIEWER)).toEqual({ listen: true, comment: false, uploadVersions: false, editMetadata: false, download: false });
    expect(await can(COMMENTER)).toEqual({ listen: true, comment: true, uploadVersions: false, editMetadata: false, download: false });
    expect(await can(CONTRIBUTOR)).toEqual({ listen: true, comment: true, uploadVersions: true, editMetadata: false, download: true });
    expect(await can(EDITOR)).toEqual({ listen: true, comment: true, uploadVersions: true, editMetadata: true, download: true });
    // A viewer with downloads allowed gets the link.
    db.tables.project_members.find((m) => m.user_id === VIEWER)!.allow_downloads = true;
    const v = (await (await call('[orgId]/projects/[id]/route.ts', 'GET', VIEWER)).json()).shared;
    expect(v.me.can.download).toBe(true);
    expect(v.recordings[0].downloadUrl).toBe(`/api/org/${L}/audio/${S1}?variant=full&download=1`);
  });

  it('upload: a viewer and a commenter are refused at the gate; a contributor and an editor reach the handlers', async () => {
    for (const user of [VIEWER, COMMENTER]) {
      for (const [path, method] of [['[orgId]/upload/part/route.ts', 'POST'], ['[orgId]/upload/abort/route.ts', 'POST'], ['[orgId]/upload/status/route.ts', 'GET']] as const) {
        expect((await call(path, method, user)).status, `${user} ${path}`).toBe(403);
      }
      const init = await call('[orgId]/upload/init/route.ts', 'POST', user, {
        body: { fileName: 'v2.wav', fileSize: 1000, as: { kind: 'link', songId: S1, relation: 'version' } },
      });
      expect(init.status).toBe(403);
    }
    for (const user of [CONTRIBUTOR, EDITOR]) {
      // Past the gate: the handlers answer for the missing session / sessionId, not for access.
      expect((await call('[orgId]/upload/part/route.ts', 'POST', user)).status).toBe(400);
      expect((await call('[orgId]/upload/status/route.ts', 'GET', user)).status).toBe(400);
      expect((await call('[orgId]/upload/abort/route.ts', 'POST', user)).status).toBe(400);
    }
  });

  it('upload init: new songs for an artist, master / demo material and another project’s song are refused', async () => {
    const init = (user: string, as: unknown) => call('[orgId]/upload/init/route.ts', 'POST', user, { body: { fileName: 'v2.wav', fileSize: 1000, as } });
    // An artist's new song needs an artist scope they cannot have.
    expect((await init(EDITOR, { kind: 'song', contactId: C1 })).status).toBe(404);
    // Material that vouches for finished music, or any kind but a new version.
    for (const relation of ['master', 'instrumental', 'demo', 'loop', 'topline']) {
      expect((await init(EDITOR, { kind: 'link', songId: S1, relation })).status, relation).toBe(403);
    }
    // A song in the same org but another project; a song in another org.
    expect((await init(EDITOR, { kind: 'link', songId: S2, relation: 'version' })).status).toBe(404);
    expect((await init(EDITOR, { kind: 'link', songId: XS, relation: 'version' })).status).toBe(404);
  });
});

describe('comments (LABEL-22): an external member of the project, per role', () => {
  const route = '[orgId]/projects/[id]/comments/route.ts';

  it('every role reads the artist-visible comments of THEIR project and never the internal one', async () => {
    for (const user of Object.values(ROLES)) {
      const res = await call(route, 'GET', user);
      expect(res.status, user).toBe(200);
      const text = JSON.stringify(await res.json());
      expect(text).toContain('Open note');
      expect(text).not.toContain('Team-only note');
      expect(text).not.toContain('"internal"');
    }
  });

  it('who may comment is the §2.6 column: a viewer cannot, a commenter / contributor / editor can — never internal', async () => {
    expect((await call(route, 'POST', VIEWER, { body: { body: 'hi' } })).status).toBe(403);
    for (const user of [COMMENTER, CONTRIBUTOR, EDITOR]) {
      expect((await call(route, 'POST', user, { body: { body: 'hi', track_id: S1 } })).status, user).toBe(201);
      expect((await call(route, 'POST', user, { body: { body: 'hi', visibility: 'internal' } })).status, user).toBe(403);
    }
  });

  it('they cannot reach an internal comment by id (404), nor change another’s, nor reach a comment of another project', async () => {
    // The internal one, and the artist-visible one of another project:
    const mod = await loaders['./[orgId]/projects/[id]/comments/[commentId]/route.ts']();
    const ask = (method: 'PATCH' | 'DELETE', user: string, commentId: string, project = P1, body: unknown = { resolved: true }) => {
      current = user;
      const handler = mod[method] as (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
      return handler(
        new NextRequest(`https://app.test/api/org/${L}/projects/${project}/comments/${commentId}`, {
          method,
          ...(method === 'PATCH' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
        }),
        { params: Promise.resolve({ orgId: L, id: project, commentId }) },
      );
    };
    for (const user of Object.values(ROLES)) {
      expect((await ask('PATCH', user, INTERNAL)).status, user).toBe(404);
      expect((await ask('DELETE', user, INTERNAL)).status, user).toBe(404);
    }
    // A member of another project of the same org: 404 on the project itself.
    expect((await ask('PATCH', OTHER, COMMENT)).status).toBe(404);
    expect((await call(route, 'GET', OTHER)).status).toBe(404); // OTHER is a member of XP in another org, P1 is not theirs
    expect(db.tables.project_comments.find((r) => r.id === INTERNAL)).toMatchObject({ body: 'Team-only note', deleted_at: null, resolved_at: null });
  });

  it('a stranger, and a removed or expired member, get nothing', async () => {
    expect((await call(route, 'GET', STRANGER)).status).toBe(404);
    db.tables.project_members = db.tables.project_members.filter((m) => m.user_id !== COMMENTER);
    expect((await call(route, 'GET', COMMENTER)).status).toBe(404);
    expect((await call(route, 'POST', COMMENTER, { body: { body: 'hi' } })).status).toBe(404);
    db.tables.project_members.find((m) => m.user_id === EDITOR)!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await call(route, 'GET', EDITOR)).status).toBe(404);
  });
});

describe('revocation and expiry take effect on the very next request', () => {
  const reads = async (user: string) => ({
    project: (await call('[orgId]/projects/[id]/route.ts', 'GET', user)).status,
    shared: (await (await call('shared/route.ts', 'GET', user)).json()).projects.length as number,
    init: (
      await call('[orgId]/upload/init/route.ts', 'POST', user, {
        body: { fileName: 'v2.wav', fileSize: 1000, as: { kind: 'link', songId: S1, relation: 'version' } },
      })
    ).status,
    part: (await call('[orgId]/upload/part/route.ts', 'POST', user)).status,
  });

  it('a live editor reaches the project and the upload gate', async () => {
    expect(await reads(EDITOR)).toMatchObject({ project: 200, shared: 1, part: 400 });
  });

  it('removing the membership: 404 / 403 immediately, and nothing listed', async () => {
    db.tables.project_members = db.tables.project_members.filter((m) => m.user_id !== EDITOR);
    expect(await reads(EDITOR)).toEqual({ project: 404, shared: 0, init: 404, part: 403 });
  });

  it('an expiry in the past ends it the same way', async () => {
    db.tables.project_members.find((m) => m.user_id === EDITOR)!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await reads(EDITOR)).toEqual({ project: 404, shared: 0, init: 404, part: 403 });
  });

  it('a future expiry is still live', async () => {
    db.tables.project_members.find((m) => m.user_id === EDITOR)!.expires_at = new Date(Date.now() + 3600_000).toISOString();
    expect((await reads(EDITOR)).project).toBe(200);
  });

  it('a soft-deleted org takes its external members with it', async () => {
    db.tables.organizations.find((o) => o.id === L)!.deleted_at = new Date().toISOString();
    expect(await reads(EDITOR)).toEqual({ project: 404, shared: 0, init: 404, part: 403 });
  });

  it('a membership of another project does not open this one', async () => {
    expect((await call('[orgId]/projects/[id]/route.ts', 'GET', OTHER)).status).toBe(404);
  });
});
