/**
 * /api/org/[orgId]/digest and /digest/slack (LABEL-38), through the REAL
 * lib/auth/org-access, store and activity writer against an in-memory
 * database. Proven: a member can only touch their own switch; only
 * `org.manage` reaches the Slack routes; the webhook URL is validated, stored
 * encrypted, never returned and never in an event; a failed audit event puts
 * the previous value back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { SLACK_PATH, SLACK_TEST_URL } from '@/lib/labelos/mocks/slack-url';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const ART = u(3);
const X = u(7);
const STRANGER = u(9);
const SLACK = SLACK_TEST_URL;

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let failEvents = false;
let breakChannelAfterEvent = false;
let channelBroken = false;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (channelBroken && table === 'org_digest_channels') {
        const q: Record<string, unknown> = {};
        const res = { data: null, error: { message: 'down' } };
        for (const m of ['update', 'delete', 'eq', 'is', 'select']) q[m] = () => q;
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
        return q;
      }
      if (failEvents && table === 'activity_events') {
        if (breakChannelAfterEvent) channelBroken = true;
        const q: Record<string, unknown> = {};
        const res = { data: null, error: { message: 'boom' } };
        for (const m of ['insert', 'select', 'single']) q[m] = () => q;
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
        return q;
      }
      return mem.client.from(table);
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '127.0.0.1', rateLimit: () => true }));

const member = (user: string, role: string, functions: string[] = [], org = L) => ({ org_id: org, user_id: user, role, functions, scope: role === 'artist' ? 'artists' : 'org', cap_grants: [], cap_revokes: [], joined_at: '2026-01-01T00:00:00Z' });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  process.env.DIGEST_SECRET = 'test-secret';
  current = null;
  failEvents = false;
  breakChannelAfterEvent = false;
  channelBroken = false;
  db = {
    tables: {
      organizations: [
        { id: L, name: 'North Star', slug: 'north-star', kind: 'label', deleted_at: null, settings: {} },
        { id: L2, name: 'Other', slug: 'other', kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [member(OWN, 'owner'), member(AR, 'member', ['a_and_r']), member(ART, 'artist'), member(X, 'owner', [], L2)],
      member_artist_scopes: [],
      org_digest_members: [],
      org_digest_channels: [],
      activity_events: [],
    },
    unique: { org_digest_members: [['org_id', 'user_id']], org_digest_channels: [['org_id']] },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<{ orgId: string }> }) => Promise<Response>;
async function call(route: 'digest' | 'slack', method: string, as: string | null, body?: unknown, org = L) {
  current = as;
  const mod = (await (route === 'digest' ? import('./route') : import('./slack/route'))) as unknown as Record<string, Handler>;
  const url = `https://app.test/api/org/${org}/digest${route === 'slack' ? '/slack' : ''}`;
  return mod[method](new NextRequest(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }), { params: Promise.resolve({ orgId: org }) });
}

describe('the member’s own switch', () => {
  it('is off by default, turns on and off, and records the change once', async () => {
    expect(await (await call('digest', 'GET', AR)).json()).toMatchObject({ schemaReady: true, enabled: false, canManage: false });
    expect((await call('digest', 'PUT', AR, { enabled: true })).status).toBe(200);
    expect(await (await call('digest', 'GET', AR)).json()).toMatchObject({ enabled: true });
    await call('digest', 'PUT', AR, { enabled: true }); // no change, no second event
    expect(db.tables.activity_events.map((e) => e.verb)).toEqual(['digest.subscribed']);
    await call('digest', 'PUT', AR, { enabled: false });
    expect(db.tables.activity_events.map((e) => e.verb)).toEqual(['digest.subscribed', 'digest.unsubscribed']);
    expect(db.tables.activity_events.every((e) => e.actor_id === AR && e.visibility === 'internal')).toBe(true);
  });

  it('writes only the caller’s own (org, user) row, whatever the body says', async () => {
    await call('digest', 'PUT', AR, { enabled: true });
    expect(await (await call('digest', 'PUT', AR, { enabled: true, user_id: OWN })).json()).toMatchObject({ error: expect.any(String) });
    expect(db.tables.org_digest_members).toEqual([expect.objectContaining({ org_id: L, user_id: AR, enabled: true })]);
  });

  it('is open to a roster artist (their own scoped digest), and refused to strangers and signed-out callers', async () => {
    expect((await call('digest', 'PUT', ART, { enabled: true })).status).toBe(200);
    expect((await call('digest', 'GET', null)).status).toBe(401);
    expect([403, 404]).toContain((await call('digest', 'GET', STRANGER)).status);
    expect([403, 404]).toContain((await call('digest', 'PUT', X, { enabled: true })).status);
    expect(db.tables.org_digest_members.filter((r) => r.user_id === X)).toEqual([]);
  });

  it('rejects a malformed body', async () => {
    expect((await call('digest', 'PUT', AR, { enabled: 'yes' })).status).toBe(400);
    expect((await call('digest', 'PUT', AR, {})).status).toBe(400);
  });

  it('says whether the channel is set only to someone who manages the org, and never the URL', async () => {
    await call('slack', 'PUT', OWN, { url: SLACK });
    const member_ = await (await call('digest', 'GET', AR)).json();
    expect(member_).not.toHaveProperty('channelConfigured');
    const owner = await (await call('digest', 'GET', OWN)).json();
    expect(owner).toMatchObject({ canManage: true, channelConfigured: true });
    expect(JSON.stringify([member_, owner])).not.toContain('hooks.slack.com');
  });
});

describe('the Slack webhook', () => {
  it('is for owners and admins only', async () => {
    for (const who of [AR, ART, STRANGER, X]) {
      const res = await call('slack', 'PUT', who, { url: SLACK });
      expect([403, 404], who).toContain(res.status);
      expect([403, 404], who).toContain((await call('slack', 'DELETE', who)).status);
    }
    expect((await call('slack', 'PUT', null, { url: SLACK })).status).toBe(401);
    expect(db.tables.org_digest_channels).toEqual([]);
  });

  it('stores it encrypted, answers only `configured`, and keeps the URL out of the event', async () => {
    const res = await call('slack', 'PUT', OWN, { url: ` ${SLACK} ` });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ configured: true });
    expect(text).not.toContain('slack');
    const row = db.tables.org_digest_channels[0] as { slack_webhook_cipher: string };
    expect(row.slack_webhook_cipher.startsWith('v1.')).toBe(true);
    expect(JSON.stringify(row)).not.toContain('abcdefgh');
    expect(JSON.stringify(db.tables.activity_events)).not.toMatch(/hooks\.slack|abcdefgh/);
    expect(db.tables.activity_events[0]).toMatchObject({ verb: 'digest.channel_set', audit: true });
  });

  it.each([
    ['another host', `https://example.com${SLACK_PATH}`],
    ['http', SLACK.replace('https', 'http')],
    ['a private address', 'https://169.254.169.254/latest'],
    ['nothing', ''],
  ])('refuses %s without storing or echoing it', async (_, url) => {
    const res = await call('slack', 'PUT', OWN, { url });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(url || '\u0000');
    expect(db.tables.org_digest_channels).toEqual([]);
  });

  it('a failed audit event puts the old value back (and removes a first-time row)', async () => {
    failEvents = true;
    expect((await call('slack', 'PUT', OWN, { url: SLACK })).status).toBe(500);
    expect(db.tables.org_digest_channels).toEqual([]);
    failEvents = false;
    await call('slack', 'PUT', OWN, { url: SLACK });
    const before = (db.tables.org_digest_channels[0] as { slack_webhook_cipher: string }).slack_webhook_cipher;
    failEvents = true;
    expect((await call('slack', 'DELETE', OWN)).status).toBe(500);
    expect((db.tables.org_digest_channels[0] as { slack_webhook_cipher: string }).slack_webhook_cipher).toBe(before);
  });

  it('says the state is uncertain, loudly, when the undo itself fails', async () => {
    failEvents = true;
    breakChannelAfterEvent = true;
    const res = await call('slack', 'PUT', OWN, { url: SLACK_TEST_URL });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ uncertain: true });
  });

  it('an undo never clobbers a save someone else made in between (it compares what it wrote)', async () => {
    await call('slack', 'PUT', OWN, { url: SLACK_TEST_URL });
    const mine = (db.tables.org_digest_channels[0] as { slack_webhook_cipher: string }).slack_webhook_cipher;
    const { undoChannelChange } = await import('@/lib/labelos/weekly-digest-store');
    (db.tables.org_digest_channels[0] as { slack_webhook_cipher: string }).slack_webhook_cipher = 'theirs';
    expect(await undoChannelChange(mem.client as never, L, { previous: { cipher: 'old' }, written: mine })).toBe(true);
    expect((db.tables.org_digest_channels[0] as { slack_webhook_cipher: string }).slack_webhook_cipher).toBe('theirs');
  });

  it('reports a saved webhook this server can no longer open, as a boolean, to managers only', async () => {
    await call('slack', 'PUT', OWN, { url: SLACK_TEST_URL });
    expect(await (await call('digest', 'GET', OWN)).json()).toMatchObject({ channelConfigured: true, needsReset: false });
    process.env.DIGEST_SECRET = 'a-different-secret';
    const owner = await (await call('digest', 'GET', OWN)).json();
    expect(owner).toMatchObject({ channelConfigured: true, needsReset: true });
    expect(await (await call('digest', 'GET', AR)).json()).not.toHaveProperty('needsReset');
    await call('slack', 'PUT', OWN, { url: SLACK_TEST_URL });
    expect(await (await call('digest', 'GET', OWN)).json()).toMatchObject({ needsReset: false });
  });

  it('removes it with an audit event, and a second removal is a quiet no-op', async () => {
    await call('slack', 'PUT', OWN, { url: SLACK });
    expect(await (await call('slack', 'DELETE', OWN)).json()).toEqual({ configured: false });
    expect((db.tables.org_digest_channels[0] as { slack_webhook_cipher: string | null }).slack_webhook_cipher).toBeNull();
    expect(await (await call('slack', 'DELETE', OWN)).json()).toEqual({ configured: false });
    expect(db.tables.activity_events.map((e) => e.verb)).toEqual(['digest.channel_set', 'digest.channel_removed']);
  });

  it('cannot store a webhook with no server secret', async () => {
    delete process.env.DIGEST_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await call('slack', 'PUT', OWN, { url: SLACK });
    expect(res.status).toBe(503);
    expect(db.tables.org_digest_channels).toEqual([]);
  });
});
