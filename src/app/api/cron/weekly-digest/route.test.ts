/**
 * GET /api/cron/weekly-digest (LABEL-38), through the REAL org-access,
 * attention-store, activity-store, weekly-digest-store and runner against an
 * in-memory database that evaluates every filter (and the same compare-and-set
 * the SQL claim is). Only Resend, Slack's fetch and the auth user lookup are
 * faked.
 *
 *   L (label), "now" = Tuesday 2026-10-13 (ISO week 2026-W42):
 *     Nova (C1): project LP1, song Midnight (in development 41 days), release
 *       Nova EP; Kilo (C2): Inbox LP2, song Dawn (in review), release Kilo single.
 *     A working demo "Secret demo" (D4: marketing may not read it).
 *   Members: OWN (owner), AR (A&R, whole org), MKT (marketing), AR_C2 (A&R
 *   scoped to Kilo), GONE (opted in, no longer a member). L2: X, an owner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { encryptWebhook } from '@/lib/labelos/webhook-secret';
import { SLACK_TEST_URL } from '@/lib/labelos/mocks/slack-url';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const MKT = u(3);
const AR_C2 = u(5);
const X = u(7);
const GONE = u(9);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const M1 = t(2);
const S2 = t(3);
const S3 = t(5);
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const SLACK = SLACK_TEST_URL;

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
let posted: Array<{ url: string; body: string; redirect?: string }> = [];
let emailOk = true;
let slackStatus = 200;

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mem.client.from(table),
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: id === GONE ? null : { id, email: `${id.slice(-2)}@digest.test`, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }) } },
  }),
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (m: { to: string; subject: string; text: string; html: string }) => {
        if (!emailOk) return { data: null, error: { message: 'nope' } };
        sent.push(m);
        return { data: { id: 'r1' }, error: null };
      },
    };
  },
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [], joined_at: '2026-01-01T00:00:00Z' };
}
const track = (id: string, org: string | null, type: string, title: string, song_stage: string | null, created_at = '2026-08-01T00:00:00Z') => ({ id, org_id: org, user_id: org ? null : OWN, created_by: AR, type, title, song_stage, isrc: null, created_at });
const release = (id: string, project: string, contact: string, title: string, target_date: string) => ({
  id, org_id: L, project_id: project, contact_id: contact, title, type: 'single', upc: null, label_name: null, c_line: null, p_line: null,
  primary_genre: null, target_date, release_date: null, artwork_asset_id: null, state: 'draft', created_by: OWN,
});
const event = (n: number, verb: string, over: Record<string, unknown>) => ({
  id: `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, org_id: L, actor_id: AR, verb, artist_id: null, project_id: null, song_id: null, release_id: null,
  subject_type: 'release', subject_id: null, payload: {}, visibility: 'artist', created_at: `2026-10-${String(8 + n).padStart(2, '0')}T10:00:00.000Z`, ...over,
});
const optIn = (user: string, org = L, lastSentWeek = '') => ({ org_id: org, user_id: user, enabled: true, last_sent_week: lastSentWeek, updated_at: '2026-10-01T00:00:00Z' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T09:00:00Z'));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  process.env.RESEND_API_KEY = 're_test';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';
  delete process.env.DIGEST_SECRET;
  sent = [];
  posted = [];
  emailOk = true;
  slackStatus = 200;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    posted.push({ url, body: String(init.body), redirect: init.redirect as string });
    return new Response('ok', { status: slackStatus });
  });
  db = {
    tables: {
      organizations: [
        { id: L, name: 'North Star', slug: 'north-star', kind: 'label', deleted_at: null, settings: {} },
        { id: L2, name: 'Other', slug: 'other', kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [member(OWN, 'owner'), member(AR, 'member', ['a_and_r']), member(MKT, 'member', ['marketing']), member(AR_C2, 'member', ['a_and_r'], 'artists'), member(X, 'owner', [], 'org', L2)],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: M1, position: 1 },
        { project_id: LP1, track_id: S3, position: 2 },
        { project_id: LP2, track_id: S2, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Midnight', 'in_development'),
        track(M1, L, 'song', 'Midnight (master)', null),
        track(S2, L, 'song', 'Dawn', 'in_review'),
        track(S3, L, 'song', 'Secret demo', 'in_development'),
      ],
      track_links: [{ from_track_id: S1, to_track_id: M1, relation: 'master', user_id: null }],
      song_beats: [],
      project_assets: [],
      parties: [],
      track_collaborators: [],
      split_sheets: [],
      split_lines: [],
      approvals: [],
      releases: [release(R1, LP1, C1, 'Nova EP', '2026-11-05'), release(R2, LP2, C2, 'Kilo single', '2026-11-01')],
      release_items: [],
      tasks: [],
      activity_events: [
        event(1, 'release.created', { artist_id: C1, release_id: R1, payload: { title: 'Nova EP' } }),
        event(2, 'release.created', { artist_id: C2, release_id: R2, payload: { title: 'Kilo single' } }),
        event(3, 'org.settings_changed', { subject_type: 'org', visibility: 'internal' }),
        event(4, 'digest.subscribed', { subject_type: 'member', visibility: 'internal' }),
        { ...event(5, 'release.created', { artist_id: C1, release_id: R1, payload: { title: 'Ancient' } }), created_at: '2026-08-01T10:00:00.000Z' },
      ],
      user_profiles: [
        { user_id: OWN, display_name: 'Owner' },
        { user_id: AR, display_name: 'Ada' },
      ],
      org_digest_members: [optIn(OWN), optIn(AR_C2), optIn(MKT), optIn(GONE), optIn(X, L2)],
      org_digest_channels: [],
    },
  };
  mem = memoryAdmin(db);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const { GET } = await import('./route');
const request = (secret?: string) => new NextRequest('http://localhost/api/cron/weekly-digest', { headers: secret ? { authorization: `Bearer ${secret}` } : undefined });
const run = () => GET(request('cron-secret'));
const to = (id: string) => `${id.slice(-2)}@digest.test`;
const mailTo = (id: string) => sent.filter((m) => m.to === to(id));

describe('auth and switches', () => {
  it('rejects a request without the secret, and a server without one', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('wrong'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request('cron-secret'))).status).toBe(500);
  });

  it('is a no-op where the digest tables are not applied', async () => {
    delete db.tables.org_digest_members;
    delete db.tables.org_digest_channels;
    const res = await run();
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
  });

  it('without a Resend key it sends nothing and claims nothing', async () => {
    delete process.env.RESEND_API_KEY;
    const body = await (await run()).json();
    expect(body.emailed).toBe(0);
    expect(sent).toEqual([]);
    expect(db.tables.org_digest_members.every((r) => r.last_sent_week === '')).toBe(true);
  });
});

describe('the digest is built through each recipient’s own scope', () => {
  it('sends one email per due member and names only what that member may see', async () => {
    const body = await (await run()).json();
    // L2's owner is due too, but their org has nothing to say: no email.
    expect(body).toMatchObject({ week: '2026-W42', emailed: 3, empty: 1 });
    expect(sent.map((m) => m.to).sort()).toEqual([to(OWN), to(AR_C2), to(MKT)].sort());

    const owner = mailTo(OWN)[0];
    expect(owner.text).toContain('Nova EP');
    expect(owner.text).toContain('Kilo single');
    expect(owner.text).toContain('Secret demo');
    expect(owner.text).toContain('https://app.test/o/north-star/releases/');
    expect(owner.subject).toMatch(/^North Star:/);

    // Scoped to Kilo: Kilo's release and song, none of Nova's, nothing internal.
    const scoped = mailTo(AR_C2)[0];
    expect(scoped.text).toContain('Kilo single');
    expect(scoped.text).toContain('Dawn');
    for (const hidden of ['Nova', 'Midnight', 'Secret demo', 'Ancient']) {
      expect(scoped.text, hidden).not.toContain(hidden);
      expect(scoped.html, hidden).not.toContain(hidden);
      expect(scoped.subject, hidden).not.toContain(hidden);
    }
    expect(scoped.text).not.toMatch(/changed the organization|restricted|hidden|withheld/i);

    // D4: marketing reads finished audio only.
    const marketing = mailTo(MKT)[0];
    expect(marketing.text).not.toContain('Secret demo');
    expect(marketing.text).not.toMatch(/restricted|hidden|withheld/i);

    // An older event is outside the week; digest housekeeping is not news.
    expect(owner.text).not.toContain('Ancient');
    expect(owner.text).not.toContain('Ada turned');
  });

  it('never sends to someone who is no longer a member, and does not claim for them', async () => {
    await run();
    expect(mailTo(GONE)).toEqual([]);
    expect(db.tables.org_digest_members.find((r) => r.user_id === GONE)!.last_sent_week).toBe('');
  });

  it('a member who lost catalog.read gets nothing', async () => {
    db.tables.org_members = db.tables.org_members.map((m) => (m.user_id === MKT ? { ...m, cap_revokes: ['catalog.read'] } : m));
    await run();
    expect(mailTo(MKT)).toEqual([]);
  });

  it('a soft-deleted org gets nothing', async () => {
    db.tables.organizations[0].deleted_at = '2026-10-12T00:00:00Z';
    await run();
    expect(sent).toEqual([]);
    expect(db.tables.org_digest_members.filter((r) => r.org_id === L).every((r) => r.last_sent_week === '')).toBe(true);
  });

  it('skips a member with nothing to say, without emailing', async () => {
    db.tables.releases = [];
    db.tables.tracks = [];
    db.tables.activity_events = [];
    const body = await (await run()).json();
    expect(body.emailed).toBe(0);
    expect(sent).toEqual([]);
    expect(body.empty).toBeGreaterThan(0);
  });
});

describe('once per ISO week', () => {
  it('a second run in the same week sends nothing', async () => {
    await run();
    const first = sent.length;
    expect(first).toBe(3);
    const again = await (await run()).json();
    expect(again).toMatchObject({ emailed: 0, slacked: 0 });
    expect(sent).toHaveLength(first);
    // A day later, still the same week.
    vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
    await run();
    expect(sent).toHaveLength(first);
  });

  it('concurrent runs send each digest once', async () => {
    await Promise.all([run(), run(), run()]);
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((m) => m.to)).size).toBe(3);
  });

  it('sends again the next week', async () => {
    await run();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    await run();
    expect(sent).toHaveLength(6);
  });

  it('a failed send gives the claim back and the next run delivers it', async () => {
    emailOk = false;
    const failed = await (await run()).json();
    expect(failed).toMatchObject({ emailed: 0, failed: 3 });
    expect(db.tables.org_digest_members.filter((r) => r.org_id === L).every((r) => r.last_sent_week === '')).toBe(true);
    emailOk = true;
    await run();
    expect(sent).toHaveLength(3);
    await run();
    expect(sent).toHaveLength(3);
  });
});

describe('Slack', () => {
  beforeEach(() => {
    process.env.DIGEST_SECRET = 'test-secret';
    db.tables.org_digest_channels = [{ org_id: L, slack_webhook_cipher: encryptWebhook(SLACK, L), slack_last_week: '', configured_by: OWN, updated_at: '2026-10-01T00:00:00Z' }];
  });

  it('posts once a week to the stored webhook without following redirects, from an owner or admin’s view', async () => {
    const body = await (await run()).json();
    expect(body.slacked).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe(SLACK);
    expect(posted[0].redirect).toBe('manual');
    expect(posted[0].body).toContain('Nova EP');
    expect(posted[0].body).toContain('Kilo single');
    expect((await (await run()).json()).slacked).toBe(0);
    expect(posted).toHaveLength(1);
  });

  it('concurrent runs post once', async () => {
    await Promise.all([run(), run()]);
    expect(posted).toHaveLength(1);
  });

  it('a failed post gives the channel claim back', async () => {
    slackStatus = 500;
    expect((await (await run()).json()).slacked).toBe(0);
    expect(db.tables.org_digest_channels[0].slack_last_week).toBe('');
    slackStatus = 200;
    expect((await (await run()).json()).slacked).toBe(1);
  });

  it('with no server secret the channel is left alone', async () => {
    delete process.env.DIGEST_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const body = await (await run()).json();
    expect(body.slacked ?? 0).toBe(0);
    expect(posted).toEqual([]);
  });

  it('a stored value that does not open (another org’s) posts nothing', async () => {
    db.tables.org_digest_channels[0].slack_webhook_cipher = encryptWebhook(SLACK, L2);
    expect((await (await run()).json()).slacked).toBe(0);
    expect(posted).toEqual([]);
  });
});
