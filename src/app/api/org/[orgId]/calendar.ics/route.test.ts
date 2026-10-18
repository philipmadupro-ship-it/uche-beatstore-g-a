/**
 * The release calendar feed (LABEL-34): the management route
 * (…/calendar/feed: issue, rotate, revoke) and the token-authenticated
 * …/calendar.ics, through the REAL lib/auth/org-access, feed-store and
 * activity writer against an in-memory database.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). Nova: project LP1, releases R1
 *     (dated), R3 (target date only), R4 (cancelled), R5 (no date).
 *     Kilo: Inbox LP2, release R2. Members: owner and A&R (whole org),
 *     A&R scoped to Kilo, marketing (catalog.read only), an operations member
 *     (no catalogue ability), a roster artist scoped to Nova.
 *   L2: release RX.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const MKT = u(3);
const AR_C2 = u(5);
const ARTIST = u(6);
const X = u(7);
const FIN = u(8);
const STRANGER = u(9);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const rid = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let limited = false;
/** Keys the limiter was asked about, and the key prefixes it refuses. */
let limiterKeys: string[] = [];
let refuse: string[] = [];
let clock = Date.parse('2026-10-13T09:00:00.000Z');

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async (key: string) => { limiterKeys.push(key); return !limited && !refuse.some((p) => key.startsWith(p)); }, clientIp: () => '127.0.0.1', rateLimit: () => true }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L, extra: Record<string, unknown> = {}) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [], joined_at: '2026-09-01T10:00:00+00:00', ...extra };
}
function release(id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) {
  return { id, org_id: org, project_id: project, contact_id: contact, title: 'Nova EP', state: 'draft', target_date: null, release_date: null, updated_at: '2026-10-01T08:30:00.000Z', created_at: '2026-10-01', ...extra };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = Date.parse('2026-10-13T09:00:00.000Z');
  vi.setSystemTime(clock);
  current = null;
  limited = false;
  limiterKeys = [];
  refuse = [];
  db = {
    tables: {
      organizations: [
        { id: L, name: 'Night Shift', kind: 'label', deleted_at: null, settings: {} },
        { id: L2, name: 'Other Label', kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(ARTIST, 'artist', [], 'artists'),
        member(FIN, 'member', ['operations']),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [
        { org_id: L, user_id: AR_C2, contact_id: C2 },
        { org_id: L, user_id: ARTIST, contact_id: C1 },
      ],
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
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }],
      releases: [
        release(rid(1), L, LP1, C1, { title: 'Midnight Run', release_date: '2026-11-06' }),
        release(rid(2), L, LP2, C2, { title: 'Kilo LP', release_date: '2026-12-01' }),
        release(rid(3), L, LP1, C1, { title: 'Target Only', target_date: '2026-11-20' }),
        release(rid(4), L, LP1, C1, { title: 'Cancelled One', release_date: '2026-11-07', state: 'cancelled' }),
        release(rid(5), L, LP1, C1, { title: 'No Date' }),
        release(rid(9), L2, XP1, CX, { title: 'Xen Secret', release_date: '2026-11-08' }),
      ],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

afterEach(() => vi.useRealTimers());

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Advance the clock so successive audit events are strictly ordered. */
function tick() {
  clock += 1000;
  vi.setSystemTime(clock);
}

async function manage(method: 'GET' | 'POST' | 'DELETE', as: string | null, org = L) {
  current = as;
  tick();
  const mod = (await import('../calendar/feed/route')) as unknown as Record<string, Handler>;
  return mod[method](new NextRequest(`https://app.test/api/org/${org}/calendar/feed`, { method }), { params: Promise.resolve({ orgId: org }) });
}

/** The calendar app: never signed in, only the URL. */
async function feed(path: string, org = L) {
  current = null;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const url = new URL(path, 'https://app.test');
  // Allow testing a URL for one org served by another org's path.
  url.pathname = `/api/org/${org}/calendar.ics`;
  return mod.GET(new NextRequest(url), { params: Promise.resolve({ orgId: org }) });
}

async function issue(as: string, org = L): Promise<{ path: string; token: string }> {
  const res = await manage('POST', as, org);
  expect(res.status).toBe(200);
  const { active, path } = await res.json();
  expect(active).toBe(true);
  return { path, token: new URL(path, 'https://app.test').searchParams.get('token')! };
}

const titles = (ics: string) => [...ics.matchAll(/SUMMARY:(.*)\r\n/g)].map((m) => m[1]);

describe('issuing, rotating and revoking the link', () => {
  it('is off until a link is issued, and a feed fetch without one is 404', async () => {
    expect(await (await manage('GET', AR)).json()).toEqual({ active: false });
    const fake = `${AR}.${'A'.repeat(43)}`;
    expect((await feed(`/x?token=${fake}`)).status).toBe(404);
  });

  it('issue → the same link every time it is read back → fetch works with no session', async () => {
    const { path } = await issue(AR);
    expect(path).toMatch(new RegExp(`^/api/org/${L}/calendar\\.ics\\?token=${AR}\\.[A-Za-z0-9_-]{43}$`));
    expect(await (await manage('GET', AR)).json()).toEqual({ active: true, path });
    const res = await feed(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('records calendar_feed.issued / revoked as audit events that never hold the token', async () => {
    const { token } = await issue(AR);
    await manage('DELETE', AR);
    const rows = db.tables.activity_events;
    expect(rows.map((r) => r.verb)).toEqual(['calendar_feed.issued', 'calendar_feed.revoked']);
    for (const r of rows) {
      expect(r).toMatchObject({ org_id: L, actor_id: AR, subject_type: 'member', subject_id: AR, audit: true, visibility: 'internal' });
      expect(JSON.stringify(r)).not.toContain(token.split('.')[1]);
    }
    expect(rows[0].payload).toEqual({ rotated: false });
  });

  it('rotating kills the old URL on the next fetch and the new one works', async () => {
    const first = await issue(AR);
    const second = await issue(AR);
    expect(second.token).not.toBe(first.token);
    expect((await feed(first.path)).status).toBe(404);
    expect((await feed(second.path)).status).toBe(200);
    expect(db.tables.activity_events[1].payload).toEqual({ rotated: true });
  });

  it('revoking turns the feed off; a re-issue is a new URL, never the revoked one', async () => {
    const first = await issue(AR);
    expect((await (await manage('DELETE', AR)).json())).toEqual({ active: false });
    expect((await feed(first.path)).status).toBe(404);
    expect(await (await manage('GET', AR)).json()).toEqual({ active: false });
    const again = await issue(AR);
    expect((await feed(first.path)).status).toBe(404);
    expect((await feed(again.path)).status).toBe(200);
  });

  it('revoking when nothing is on is a quiet no-op (no event)', async () => {
    expect((await manage('DELETE', AR)).status).toBe(200);
    expect(db.tables.activity_events).toEqual([]);
  });

  it('if the audit event cannot be written the link does not change', async () => {
    const first = await issue(AR);
    const real = mem.client.from;
    mem.client.from = ((table: string) => {
      if (table !== 'activity_events') return real(table);
      const q = real(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      return {
        ...q,
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }),
      };
    }) as typeof mem.client.from;
    expect((await manage('POST', AR)).status).toBe(500);
    mem.client.from = real;
    expect((await feed(first.path)).status).toBe(200);
  });

  it('is limited per member', async () => {
    limited = true;
    expect((await manage('POST', AR)).status).toBe(429);
    expect(db.tables.activity_events).toEqual([]);
  });

  it('needs a session and a catalogue ability; a non-member and the other org’s owner get 403', async () => {
    expect((await manage('POST', null)).status).toBe(401);
    expect((await manage('POST', STRANGER)).status).toBe(403);
    expect((await manage('POST', X)).status).toBe(403);
    expect((await manage('POST', FIN)).status).toBe(403);
    expect((await manage('GET', FIN)).status).toBe(403);
    expect((await manage('DELETE', FIN)).status).toBe(403);
    expect(db.tables.activity_events).toEqual([]);
  });
});

describe('the token is the only credential, and a wrong one is a plain 404', () => {
  it('missing, malformed, tampered, truncated and extended tokens are all the same 404', async () => {
    const { path, token } = await issue(AR);
    const [user, mac] = token.split('.');
    const flipped = `${user}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    const bodies = new Set<string>();
    for (const bad of ['', 'nope', user, `${user}.`, flipped, `${token}x`, mac.slice(1), `${OWN}.${mac}`, `${user.toUpperCase()}.${mac}x`]) {
      const res = await feed(`/x?token=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(404);
      bodies.add(await res.text());
    }
    expect((await feed(`/x`)).status).toBe(404);
    expect(bodies.size).toBe(1);
    expect((await feed(path)).status).toBe(200);
  });

  it('is per user: someone else’s id with your MAC is 404, and so is their own valid-looking id with no link', async () => {
    const { token } = await issue(AR);
    const mac = token.split('.')[1];
    expect((await feed(`/x?token=${OWN}.${mac}`)).status).toBe(404);
    expect((await feed(`/x?token=${MKT}.${mac}`)).status).toBe(404);
  });

  it('is per org: a token from L does not open L2 (and L2’s own owner’s token does not open L)', async () => {
    const mine = await issue(AR);
    expect((await feed(mine.path, L2)).status).toBe(404);
    const theirs = await issue(X, L2);
    expect((await feed(theirs.path, L)).status).toBe(404);
    expect((await feed(theirs.path, L2)).status).toBe(200);
  });

  it('a stranger’s guess and a non-member’s id answer exactly like a bad MAC', async () => {
    await issue(AR);
    const guess = await feed(`/x?token=${STRANGER}.${'A'.repeat(43)}`);
    const wrong = await feed(`/x?token=${AR}.${'A'.repeat(43)}`);
    expect(guess.status).toBe(404);
    expect(await guess.text()).toBe(await wrong.text());
  });

  it('leaving the org ends it, and rejoining does not bring the old URL back', async () => {
    const { path } = await issue(AR);
    const row = db.tables.org_members.find((m) => m.user_id === AR)!;
    db.tables.org_members = db.tables.org_members.filter((m) => m !== row);
    expect((await feed(path)).status).toBe(404);
    db.tables.org_members.push({ ...row, joined_at: '2026-10-20T10:00:00+00:00' });
    expect((await feed(path)).status).toBe(404);
    // …but a fresh link for the new membership works.
    expect((await feed((await issue(AR)).path)).status).toBe(200);
  });

  it('a soft-deleted org serves nothing', async () => {
    const { path } = await issue(AR);
    db.tables.organizations[0].deleted_at = '2026-10-13T00:00:00Z';
    expect((await feed(path)).status).toBe(404);
  });

  it('losing catalog.read ends it on the next fetch', async () => {
    const { path } = await issue(MKT);
    expect((await feed(path)).status).toBe(200);
    db.tables.org_members.find((m) => m.user_id === MKT)!.cap_revokes = ['catalog.read'];
    expect((await feed(path)).status).toBe(404);
  });

  it('is rate-limited', async () => {
    const { path } = await issue(AR);
    limited = true;
    const res = await feed(path);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('does not touch the database for a token that is not even shaped like one', async () => {
    const before = mem.writes.length;
    const reads = vi.spyOn(mem.client, 'from');
    expect((await feed('/x?token=zzz')).status).toBe(404);
    expect(reads).not.toHaveBeenCalled();
    expect(mem.writes.length).toBe(before);
  });
});

describe('what the feed shows', () => {
  it('whole-org members: dated, live releases of this org only, titles and dates, in date order', async () => {
    const { path } = await issue(OWN);
    const ics = await (await feed(path)).text();
    expect(titles(ics)).toEqual(['Midnight Run', 'Target Only', 'Kilo LP']);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261106');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261120');
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).not.toMatch(/Cancelled One|No Date|Xen Secret/);
    expect(ics).toContain('X-WR-CALNAME:Releases\r\n');
    expect(ics).not.toMatch(/Night Shift/);
    // No row id (release or org) anywhere in the file: UIDs are opaque keyed hashes.
    expect(ics).not.toContain(L);
    expect(ics).not.toMatch(/70000000-0000-4000/);
    expect(ics).toMatch(/UID:[0-9a-f]{32}@label-os\r\n/);
    expect(ics).not.toMatch(/Nova|Kilo(?! LP)|DESCRIPTION|URL|LOCATION|ATTENDEE/);
  });

  it('artist scope: A&R scoped to Kilo sees only Kilo’s release', async () => {
    const { path } = await issue(AR_C2);
    expect(titles(await (await feed(path)).text())).toEqual(['Kilo LP']);
  });

  it('a roster artist scoped to Nova sees only Nova’s (not Kilo’s)', async () => {
    const { path } = await issue(ARTIST);
    expect(titles(await (await feed(path)).text())).toEqual(['Midnight Run', 'Target Only']);
  });

  it('a scope with no contacts is an empty (but valid) calendar, never everything', async () => {
    const { path } = await issue(AR_C2);
    db.tables.member_artist_scopes = db.tables.member_artist_scopes.filter((s) => s.user_id !== AR_C2);
    const ics = await (await feed(path)).text();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('VEVENT');
  });

  it('a title with separators and newlines cannot inject a property', async () => {
    db.tables.releases[0].title = 'Evil, Title;\r\nATTENDEE:mailto:x@y.z';
    const { path } = await issue(OWN);
    const ics = await (await feed(path)).text();
    expect(ics).not.toMatch(/^ATTENDEE/m);
    expect(ics).toContain('SUMMARY:Evil\\, Title\\; ATTENDEE:mailto:x@y.z');
  });

  it('is identical on the next fetch when nothing changed', async () => {
    const { path } = await issue(OWN);
    expect(await (await feed(path)).text()).toBe(await (await feed(path)).text());
  });
});

describe('rate limiting cannot be turned against the member (review item 2)', () => {
  it('junk tokens and junk ids never spend the member’s own bucket', async () => {
    const { token } = await issue(AR);
    limiterKeys = [];
    for (let i = 0; i < 5; i += 1) await feed(`/x?token=${AR}.${'A'.repeat(42)}${i}`);
    await feed('/x?token=zzz');
    expect(limiterKeys.filter((k) => k.startsWith(`org-feed:${L}:${AR}`))).toEqual([]);
    // …so even with the per-IP bucket generous and the per-user one exhausted by someone else, shape errors stay 404.
    refuse = ['org-feed:'];
    expect((await feed(`/x?token=${AR}.${'A'.repeat(43)}`)).status).toBe(404);
    expect(token).toBeTruthy();
  });

  it('the member’s bucket is spent only after the token verified', async () => {
    const { path } = await issue(AR);
    limiterKeys = [];
    expect((await feed(path)).status).toBe(200);
    expect(limiterKeys).toEqual([`org-feed-ip:127.0.0.1:${L}`, `org-feed:${L}:${AR}`]);
  });

  it('a refused per-IP bucket is a 429 before any lookup', async () => {
    const { path } = await issue(AR);
    refuse = ['org-feed-ip:'];
    expect((await feed(path)).status).toBe(429);
  });

  it('a non-UUID org id is a 404 that reaches no limiter; case variants share one key', async () => {
    limiterKeys = [];
    const res = await feed(`/x?token=${AR}.${'A'.repeat(43)}`, 'not-a-uuid');
    expect(res.status).toBe(404);
    expect(limiterKeys).toEqual([]);
    await feed(`/x?token=${AR}.${'A'.repeat(43)}`, L.toUpperCase());
    await feed(`/x?token=${AR}.${'A'.repeat(43)}`, L);
    expect(new Set(limiterKeys).size).toBe(1);
  });
});

describe('revocation does not depend on how many feed events there are (review item 1)', () => {
  it('still revokes and rotates when the member has more feed events than a PostgREST page holds', async () => {
    // The old read was an ascending, capped select: past the cap it froze on the OLDEST events.
    db.maxRows = 3;
    db.tables.activity_events = Array.from({ length: 10 }, (_, i) => ({
      id: `e${String(i).padStart(2, '0')}`, org_id: L, actor_id: AR, verb: i % 2 === 0 ? 'calendar_feed.issued' : 'calendar_feed.revoked',
      subject_type: 'member', subject_id: AR, payload: {}, audit: true, visibility: 'internal', created_at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    // 10 events, the last (i=9) is a revoke: off.
    expect(await (await manage('GET', AR)).json()).toEqual({ active: false });
    const first = await issue(AR);
    expect((await feed(first.path)).status).toBe(200);
    const second = await issue(AR);
    expect(second.token).not.toBe(first.token);
    expect((await feed(first.path)).status).toBe(404);
    expect((await feed(second.path)).status).toBe(200);
    await manage('DELETE', AR);
    expect((await feed(second.path)).status).toBe(404);
    expect(await (await manage('GET', AR)).json()).toEqual({ active: false });
  });
});

describe('the feed route never logs the token', () => {
  it('has no log call that mentions the token or the request URL', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/org/[orgId]/calendar.ics/route.ts'), 'utf8');
    const logCalls = src.match(/\blog\.(?:info|warn|error|debug)\([^;]*\);/g) ?? [];
    for (const call of logCalls) expect(call).not.toMatch(/token|url|searchParams|nextUrl/i);
    expect(logCalls.length).toBeGreaterThan(0);
  });
});
