/**
 * The API producer gate in src/proxy.ts. Buyers share the producer's Supabase
 * auth, so a signed-in buyer must be refused on dashboard API routes while
 * storefront/share routes and signed-out requests pass through untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

let currentUser: { id: string } | null = null;
let producerIds = new Set<string>();
let memberIds = new Set<string>();
let membershipReads = 0;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => {
          if (table === 'creator_profiles') {
            return { maybeSingle: async () => ({ data: producerIds.has(id) ? { user_id: id } : null }) };
          }
          if (table === 'org_members') {
            return {
              limit: async () => {
                membershipReads += 1;
                return { data: memberIds.has(id) ? [{ org_id: 'org-1' }] : [], error: null };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      }),
    }),
  }),
}));

async function run(path: string) {
  const { proxy } = await import('./proxy');
  return proxy(new NextRequest(`https://example.test${path}`));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJstub');
  vi.stubEnv('ENABLE_LOCAL_STORE', '');
  vi.stubEnv('LABEL_OS_ENABLED', '');
  currentUser = null;
  producerIds = new Set(['producer-1', 'producer-member']);
  memberIds = new Set(['member-1', 'producer-member']);
  membershipReads = 0;
});

describe('proxy API producer gate', () => {
  it('refuses a signed-in buyer on dashboard API routes', async () => {
    currentUser = { id: 'buyer-1' };
    for (const path of ['/api/email', '/api/tracks', '/api/upload/init', '/api/sales', '/api/team']) {
      const res = await run(path);
      expect(res.status, path).toBe(403);
    }
  });

  it('lets a signed-in buyer use storefront and share routes', async () => {
    currentUser = { id: 'buyer-1' };
    for (const path of ['/api/store/me', '/api/store/checkout', '/api/share/tok', '/api/tracks/t1/heatmap']) {
      const res = await run(path);
      expect(res.status, path).toBe(200);
    }
  });

  it('lets the producer through', async () => {
    currentUser = { id: 'producer-1' };
    expect((await run('/api/email')).status).toBe(200);
  });

  it('leaves signed-out requests to the route (cron bearer, 401s)', async () => {
    expect((await run('/api/cron/process-uploads')).status).toBe(200);
    expect((await run('/api/email')).status).toBe(200);
  });
});

describe('proxy login redirect', () => {
  const loginTarget = (res: Response) => new URL(res.headers.get('location')!);

  // The regression: `next` used to be the pathname only, so ?track= was left
  // on /login as a stray param and signing in opened an empty studio.
  it('keeps the query string of a deep link inside `next`', async () => {
    const res = await run('/studio?track=abc-123');
    expect(res.status).toBe(307);
    const url = loginTarget(res);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/studio?track=abc-123');
    // Nothing else leaks onto the login URL itself.
    expect([...url.searchParams.keys()]).toEqual(['next']);
  });

  it('keeps several params and their encoding intact', async () => {
    const res = await run('/library?q=a%26b&sort=bpm');
    expect(loginTarget(res).searchParams.get('next')).toBe('/library?q=a%26b&sort=bpm');
  });

  it('sends a plain path unchanged', async () => {
    const res = await run('/library/track-1');
    expect(loginTarget(res).searchParams.get('next')).toBe('/library/track-1');
  });

  it('still never redirects a public share page', async () => {
    expect((await run('/projects/share/tok?x=1')).status).toBe(200);
  });
});

// ── Label OS gate (LABEL-06) ────────────────────────────────────────────────
//
// The only behaviour change allowed is on /api/org/* and /o/*. These tests
// pin that: every existing top-level API folder gates a member-only user
// exactly as it gates a buyer (and as it did before Label OS), the producer
// keeps everything, and the Label OS namespaces 404 while the flag is off.

// Every existing top-level /api folder, read from disk so a new folder is
// covered the day it lands. `org` is Label OS's own namespace (LABEL-08+).
const API_DIR = path.join(process.cwd(), 'src', 'app', 'api');
const EXISTING_API_FOLDERS = fs
  .readdirSync(API_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'org')
  .map((d) => d.name)
  .sort();

// The folder itself and a path below it: several folders are public only
// beneath a sub-path (/api/projects/share/, /api/stripe/webhook, …).
const EXISTING_API_PATHS = EXISTING_API_FOLDERS.flatMap((f) => [`/api/${f}`, `/api/${f}/x`]);

// Written out, not derived from api-gate.ts, so a change to the allowlist has
// to change this list too and shows up in review.
const PUBLIC_EXISTING_PATHS = new Set([
  '/api/csp-report', '/api/csp-report/x',
  '/api/cron/x',
  '/api/health', '/api/health/x',
  '/api/portal/x',
  '/api/share/x',
  '/api/store', '/api/store/x',
  '/api/whoami', '/api/whoami/x',
]);

describe('Label OS gate: every existing API folder is gated as before', () => {
  it('enumerates the real API folders', () => {
    // Sanity: the enumeration found the tree, not an empty directory.
    expect(EXISTING_API_FOLDERS).toEqual(expect.arrayContaining(['tracks', 'audio', 'contacts', 'store', 'team']));
    expect(EXISTING_API_FOLDERS.length).toBeGreaterThan(30);
  });

  for (const flag of ['', 'true']) {
    describe(`LABEL_OS_ENABLED=${JSON.stringify(flag)}`, () => {
      beforeEach(() => vi.stubEnv('LABEL_OS_ENABLED', flag));

      it('a member-only user is 403 on every non-public existing path', async () => {
        currentUser = { id: 'member-1' };
        for (const p of EXISTING_API_PATHS) {
          const res = await run(p);
          expect(res.status, p).toBe(PUBLIC_EXISTING_PATHS.has(p) ? 200 : 403);
          if (res.status === 403) {
            expect(await res.json(), p).toEqual({ error: 'Producer account required' });
          }
        }
        // Membership never decides an existing path.
        expect(membershipReads).toBe(0);
      });

      it('a buyer gets exactly what a member-only user gets', async () => {
        for (const p of EXISTING_API_PATHS) {
          currentUser = { id: 'buyer-1' };
          const buyer = (await run(p)).status;
          currentUser = { id: 'member-1' };
          const member = (await run(p)).status;
          expect(member, p).toBe(buyer);
        }
      });

      it('the producer is through on every existing path', async () => {
        for (const id of ['producer-1', 'producer-member']) {
          currentUser = { id };
          for (const p of EXISTING_API_PATHS) {
            expect((await run(p)).status, `${id} ${p}`).toBe(200);
          }
        }
      });

      it('signed-out requests still fall through to the route', async () => {
        for (const p of EXISTING_API_PATHS) {
          expect((await run(p)).status, p).toBe(200);
        }
      });

      it('dashboard pages still redirect as before', async () => {
        currentUser = { id: 'member-1' };
        const res = await run('/library');
        expect(res.status).toBe(307);
        expect(new URL(res.headers.get('location')!).pathname).toBe('/store/account/me');
        currentUser = { id: 'producer-1' };
        expect((await run('/library')).status).toBe(200);
        // `/offline` shares a letter with `/o` and must stay a dashboard page.
        currentUser = null;
        expect(new URL((await run('/offline')).headers.get('location')!).pathname).toBe('/login');
      });
    });
  }
});

describe('Label OS gate: flag off', () => {
  it('404s /api/org/* and /o/* for everyone', async () => {
    for (const id of [null, 'buyer-1', 'member-1', 'producer-1', 'producer-member']) {
      currentUser = id ? { id } : null;
      for (const p of ['/api/org', '/api/org/abc', '/api/org/abc/members', '/api/org/join', '/o', '/o/acme', '/o/acme/artists', '/join/tok']) {
        expect((await run(p)).status, `${id} ${p}`).toBe(404);
      }
    }
    expect(membershipReads).toBe(0);
  });

  it('answers JSON on the API and leaves look-alikes alone', async () => {
    currentUser = { id: 'producer-1' };
    expect(await (await run('/api/org/x')).json()).toEqual({ error: 'Not found' });
    // Not the namespace: a producer path like any other.
    expect((await run('/api/organizations')).status).toBe(200);
    currentUser = { id: 'member-1' };
    expect((await run('/api/organizations')).status).toBe(403);
    expect((await run('/api/orgs')).status).toBe(403);
  });

  it('treats any value but true/1 as off', async () => {
    vi.stubEnv('LABEL_OS_ENABLED', 'false');
    currentUser = { id: 'member-1' };
    expect((await run('/api/org')).status).toBe(404);
  });
});

describe('Label OS gate: flag on', () => {
  beforeEach(() => vi.stubEnv('LABEL_OS_ENABLED', 'true'));

  it('admits a member to /api/org/*', async () => {
    currentUser = { id: 'member-1' };
    for (const p of ['/api/org', '/api/org/abc', '/api/org/abc/members']) {
      expect((await run(p)).status, p).toBe(200);
    }
  });

  it('refuses a buyer on /api/org/*', async () => {
    currentUser = { id: 'buyer-1' };
    for (const p of ['/api/org', '/api/org/abc', '/api/org/join/x', '/api/org/joint']) {
      const res = await run(p);
      expect(res.status, p).toBe(403);
      expect(await res.json()).toEqual({ error: 'Organization membership required' });
    }
  });

  it('gates the producer on membership too (being the producer is not membership)', async () => {
    currentUser = { id: 'producer-1' };
    expect((await run('/api/org')).status).toBe(403);
    currentUser = { id: 'producer-member' };
    expect((await run('/api/org')).status).toBe(200);
  });

  it('leaves signed-out /api/org/* to the route (401 there)', async () => {
    expect((await run('/api/org/abc')).status).toBe(200);
    expect(membershipReads).toBe(0);
  });

  it('reads membership live on every request', async () => {
    currentUser = { id: 'member-1' };
    expect((await run('/api/org')).status).toBe(200);
    memberIds.delete('member-1');
    expect((await run('/api/org')).status).toBe(403);
    expect(membershipReads).toBe(2);
  });

  it('sends a signed-out visitor on /o/* to login with the page in `next`', async () => {
    const res = await run('/o/acme/artists?tab=beats');
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/o/acme/artists?tab=beats');
  });

  it('lets a member open /o/*', async () => {
    currentUser = { id: 'member-1' };
    expect((await run('/o')).status).toBe(200);
    expect((await run('/o/acme')).status).toBe(200);
  });

  it('sends a signed-in non-member on /o/* to /', async () => {
    for (const id of ['buyer-1', 'producer-1']) {
      currentUser = { id };
      const res = await run('/o/acme');
      expect(res.status, id).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname, id).toBe('/');
    }
  });

  it('answers 503 without a database instead of falling back to local store', async () => {
    vi.stubEnv('ENABLE_LOCAL_STORE', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    currentUser = { id: 'member-1' };
    const api = await run('/api/org');
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: 'Label OS requires a database' });
    expect((await run('/o/acme')).status).toBe(503);
    // Everything else keeps its local-store behaviour (proxy lets it through).
    expect((await run('/api/tracks')).status).toBe(200);
  });

  it('answers 503 when only the local-store fallback is configured', async () => {
    vi.stubEnv('ENABLE_LOCAL_STORE', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://dummy.example.test');
    expect((await run('/api/org')).status).toBe(503);
  });
});

// ── Joining (LABEL-08) ──────────────────────────────────────────────────────
//
// An invitee is not a member until they accept, so the membership gate would
// refuse the request that makes them one. The exception is exactly
// `/api/org/join` (and the `/join/<token>` page): any signed-in caller
// reaches the route, which does all of the authorisation. Nothing else moves:
// the table tests above still pass unchanged for every existing path.

describe('Label OS join admission (flag on)', () => {
  beforeEach(() => vi.stubEnv('LABEL_OS_ENABLED', 'true'));

  it('admits any signed-in caller to /api/org/join without reading membership', async () => {
    for (const id of ['buyer-1', 'producer-1', 'member-1']) {
      currentUser = { id };
      expect((await run('/api/org/join')).status, id).toBe(200);
    }
    expect(membershipReads).toBe(0);
  });

  it('leaves a signed-out /api/org/join to the route (401 there)', async () => {
    expect((await run('/api/org/join')).status).toBe(200);
  });

  it('admits nothing beside or below it', async () => {
    currentUser = { id: 'buyer-1' };
    for (const p of ['/api/org/join/', '/api/org/join/x', '/api/org/joint', '/api/org/abc/join', '/api/org/abc/invitations', '/api/join']) {
      const res = await run(p);
      expect(res.status, p).toBe(403);
    }
  });

  it('a buyer who joined is a member on /api/org/* and still 403 on every producer path', async () => {
    memberIds.add('buyer-1');
    currentUser = { id: 'buyer-1' };
    expect((await run('/api/org/abc/invitations')).status).toBe(200);
    for (const p of EXISTING_API_PATHS) {
      expect((await run(p)).status, p).toBe(PUBLIC_EXISTING_PATHS.has(p) ? 200 : 403);
    }
    const lib = await run('/library');
    expect(new URL(lib.headers.get('location')!).pathname).toBe('/store/account/me');
  });

  it('serves the join page to signed-out visitors, buyers and non-members (no login or / redirect)', async () => {
    for (const id of [null, 'buyer-1', 'producer-1', 'member-1']) {
      currentUser = id ? { id } : null;
      expect((await run('/join/tok')).status, String(id)).toBe(200);
    }
    expect(membershipReads).toBe(0);
  });

  it('answers 503 on the join page and route without a database', async () => {
    vi.stubEnv('ENABLE_LOCAL_STORE', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    expect((await run('/join/tok')).status).toBe(503);
    expect((await run('/api/org/join')).status).toBe(503);
  });

  it('leaves look-alike pages alone', async () => {
    currentUser = null;
    expect((await run('/join')).status).toBe(200);
    expect((await run('/joiner/x')).status).toBe(200);
  });
});
