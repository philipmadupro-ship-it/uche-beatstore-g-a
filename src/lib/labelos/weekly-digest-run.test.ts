import { describe, expect, it } from 'vitest';
import { runWeeklyDigest, type DigestPorts, type DueRow, type RecipientAccess } from './weekly-digest-run';
import type { WeeklyDigestContent } from './weekly-digest';

const ORG = 'o1';
const NOW = new Date('2026-10-12T07:20:00Z'); // 2026-W42
const WEEK = '2026-W42';
const FULL: WeeklyDigestContent = {
  orgName: 'Night Shift',
  orgSlug: 'night-shift',
  attention: [{ id: 'release:1', kind: 'release', severity: 4, title: 'EP', artistName: 'Nova', detail: 'late', person: { id: null, name: 'Sam' }, people: [], action: { verb: 'Open', href: '/o/night-shift/releases/1' }, dueDate: null }],
  activity: [],
};

/** An in-memory database with the same compare-and-set the SQL claim has. */
function fake(opts: { members?: Array<Partial<DueRow> & { userId: string }>; channel?: boolean; email?: boolean; roles?: Record<string, string | null>; content?: (r: RecipientAccess) => WeeklyDigestContent; sendOk?: boolean } = {}) {
  const rows = new Map<string, DueRow>();
  for (const m of opts.members ?? []) rows.set(`${m.orgId ?? ORG}|${m.userId}`, { orgId: ORG, enabled: true, lastSentWeek: '', ...m } as DueRow);
  const rowOf = (orgId: string, userId: string) => rows.get(`${orgId}|${userId}`);
  const channel = { present: opts.channel ?? false, week: '' };
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const posts: string[] = [];
  const builtFor: string[] = [];
  const state = { sendOk: opts.sendOk ?? true };
  const ports: DigestPorts = {
    emailConfigured: opts.email ?? true,
    baseUrl: 'https://app.test',
    async nextDueOrg(week, afterOrgId) {
      const due = [...rows.values()].filter((r) => r.enabled && r.lastSentWeek !== week && (afterOrgId === null || r.orgId > afterOrgId));
      if (due.length === 0) return null;
      const orgId = due.map((r) => r.orgId).sort()[0];
      return { orgId, members: due.filter((r) => r.orgId === orgId).map((r) => ({ ...r })) };
    },
    async dueChannels(week, afterOrgId, limit) {
      return channel.present && channel.week !== week && (afterOrgId === null || ORG > afterOrgId) ? [{ orgId: ORG, lastSentWeek: channel.week }].slice(0, limit) : [];
    },
    async orgInfo(ids) {
      return new Map(ids.map((id) => [id, { id, name: 'Night Shift', slug: 'night-shift' }]));
    },
    async recipient(orgId, userId) {
      const role = opts.roles && userId in opts.roles ? opts.roles[userId] : 'member';
      return role ? { orgId, userId, role } : null;
    },
    async content(r) {
      builtFor.push(r.userId);
      return opts.content ? opts.content(r) : FULL;
    },
    async claimMember(orgId, userId, week) {
      await Promise.resolve(); // yield, so concurrent runs interleave
      const r = rowOf(orgId, userId);
      if (!r || !r.enabled || r.lastSentWeek === week) return false;
      r.lastSentWeek = week;
      return true;
    },
    async releaseMember(orgId, userId, week, previous) {
      const r = rowOf(orgId, userId);
      if (r && r.lastSentWeek === week) r.lastSentWeek = previous;
    },
    async claimChannel(_org, week) {
      await Promise.resolve();
      if (!channel.present || channel.week === week) return false;
      channel.week = week;
      return true;
    },
    async releaseChannel(_org, week, previous) {
      if (channel.week === week) channel.week = previous;
    },
    async channelAuthors(orgId) {
      return [...rows.values()].filter((r) => r.enabled && r.orgId === orgId).map((r) => r.userId);
    },
    async emailOf(userId) {
      return `${userId}@x.test`;
    },
    async sendEmail(to, m) {
      if (!state.sendOk) return false;
      sent.push({ to, subject: m.subject, text: m.text });
      return true;
    },
    async postSlack(_org, m) {
      if (!state.sendOk) return false;
      posts.push(m.subject);
      return true;
    },
  };
  return { ports, rows, channel, sent, posts, builtFor, state };
}

describe('runWeeklyDigest', () => {
  it('sends one digest to each opted-in member, then nothing on a second run the same week', async () => {
    const f = fake({ members: [{ userId: 'a' }, { userId: 'b' }, { userId: 'off', enabled: false }] });
    const first = await runWeeklyDigest(f.ports, NOW);
    expect(first).toMatchObject({ week: WEEK, emailed: 2, failed: 0 });
    expect(f.sent.map((s) => s.to).sort()).toEqual(['a@x.test', 'b@x.test']);
    const second = await runWeeklyDigest(f.ports, new Date(NOW.getTime() + 3 * 86_400_000));
    expect(second).toMatchObject({ emailed: 0, slacked: 0 });
    expect(f.sent).toHaveLength(2);
  });

  it('sends again the next ISO week', async () => {
    const f = fake({ members: [{ userId: 'a' }] });
    await runWeeklyDigest(f.ports, NOW);
    const next = await runWeeklyDigest(f.ports, new Date('2026-10-19T07:20:00Z'));
    expect(next.emailed).toBe(1);
    expect(f.sent).toHaveLength(2);
  });

  it('concurrent runs do not double-send: the claim is a compare-and-set', async () => {
    const f = fake({ members: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }], channel: true, roles: { a: 'owner' } });
    const results = await Promise.all([runWeeklyDigest(f.ports, NOW), runWeeklyDigest(f.ports, NOW), runWeeklyDigest(f.ports, NOW)]);
    expect(f.sent).toHaveLength(3);
    expect(new Set(f.sent.map((s) => s.to)).size).toBe(3);
    expect(f.posts).toHaveLength(1);
    expect(results.reduce((n, r) => n + r.emailed, 0)).toBe(3);
  });

  it('a failed send gives the claim back, so the next run retries, and never sends twice', async () => {
    const f = fake({ members: [{ userId: 'a' }], sendOk: false });
    expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ emailed: 0, failed: 1 });
    expect(f.rows.get(`${ORG}|a`)!.lastSentWeek).toBe('');
    f.state.sendOk = true;
    expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ emailed: 1 });
    expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ emailed: 0 });
    expect(f.sent).toHaveLength(1);
  });

  it('puts back the PREVIOUS week, not a blank, when a retry fails', async () => {
    const f = fake({ members: [{ userId: 'a', lastSentWeek: '2026-W40' }], sendOk: false });
    await runWeeklyDigest(f.ports, NOW);
    expect(f.rows.get(`${ORG}|a`)!.lastSentWeek).toBe('2026-W40');
  });

  it('skips an empty digest and keeps the week claimed (nothing to say = no email)', async () => {
    const f = fake({ members: [{ userId: 'a' }], content: () => ({ ...FULL, attention: [], activity: [] }) });
    expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ emailed: 0, empty: 1 });
    expect(f.sent).toHaveLength(0);
    expect(f.rows.get(`${ORG}|a`)!.lastSentWeek).toBe(WEEK);
    expect((await runWeeklyDigest(f.ports, NOW)).empty).toBe(0);
  });

  it('re-checks membership at send time: removed, downgraded or deleted-org members get nothing and are not claimed', async () => {
    const f = fake({ members: [{ userId: 'gone' }, { userId: 'kept' }], roles: { gone: null } });
    const r = await runWeeklyDigest(f.ports, NOW);
    expect(r).toMatchObject({ emailed: 1, skipped: 1 });
    expect(f.sent.map((s) => s.to)).toEqual(['kept@x.test']);
    expect(f.builtFor).toEqual(['kept']);
    expect(f.rows.get(`${ORG}|gone`)!.lastSentWeek).toBe('');
  });

  it('builds the content for each recipient separately', async () => {
    const f = fake({
      members: [{ userId: 'scoped' }, { userId: 'whole' }],
      content: (r) => (r.userId === 'scoped' ? { ...FULL, attention: [] , activity: [{ artist: 'Nova', actor: 'Sam', text: 'added a demo' }] } : FULL),
    });
    await runWeeklyDigest(f.ports, NOW);
    expect(f.builtFor.sort()).toEqual(['scoped', 'whole']);
    const scoped = f.sent.find((s) => s.to === 'scoped@x.test')!;
    const whole = f.sent.find((s) => s.to === 'whole@x.test')!;
    expect(scoped.text).not.toContain('NEEDS ATTENTION');
    expect(whole.text).toContain('NEEDS ATTENTION');
  });

  it('without a Resend key nobody is emailed and nothing is claimed', async () => {
    const f = fake({ members: [{ userId: 'a' }], email: false });
    expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ emailed: 0 });
    expect(f.rows.get(`${ORG}|a`)!.lastSentWeek).toBe('');
  });

  it('a member with no confirmed address is skipped and the claim is returned', async () => {
    const f = fake({ members: [{ userId: 'a' }] });
    f.ports.emailOf = async () => null;
    expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ emailed: 0, skipped: 1 });
    expect(f.rows.get(`${ORG}|a`)!.lastSentWeek).toBe('');
  });

  describe('no member is starved', () => {
    const many = (n: number, org = ORG) => Array.from({ length: n }, (_, i) => ({ userId: `u${String(i).padStart(4, '0')}`, orgId: org }));

    it('serves more than a hundred due members in one run, across orgs', async () => {
      const f = fake({ members: [...many(130), ...many(40, 'o2')] });
      const r = await runWeeklyDigest(f.ports, NOW);
      expect(r).toMatchObject({ emailed: 170, stoppedForTime: false });
      expect(f.sent).toHaveLength(170);
      expect([...f.rows.values()].every((row) => row.lastSentWeek === WEEK)).toBe(true);
    });

    it('when the budget ends the run, the rest stay UNclaimed and the next run (same week) finishes them without re-sending', async () => {
      const f = fake({ members: many(30) });
      let t = 0;
      // Each member costs one tick; the budget allows ten.
      f.ports.emailOf = async (id) => { t += 1; return `${id}@x.test`; };
      const first = await runWeeklyDigest(f.ports, NOW, { budgetMs: 10, clock: () => t });
      expect(first.stoppedForTime).toBe(true);
      expect(first.emailed).toBe(10);
      expect([...f.rows.values()].filter((r) => r.lastSentWeek === '')).toHaveLength(20);
      t = 0;
      const second = await runWeeklyDigest(f.ports, new Date(NOW.getTime() + 86_400_000), { budgetMs: 10, clock: () => t });
      expect(second.emailed).toBe(10);
      t = 0;
      const third = await runWeeklyDigest(f.ports, new Date(NOW.getTime() + 2 * 86_400_000), { budgetMs: 10, clock: () => t });
      expect(third.emailed).toBe(10);
      expect(new Set(f.sent.map((s) => s.to)).size).toBe(30);
      expect(f.sent).toHaveLength(30);
    });

    it('a member whose send keeps failing at the front does not stop the ones behind them', async () => {
      const f = fake({ members: many(5) });
      const real = f.ports.sendEmail;
      f.ports.sendEmail = async (to, m) => (to.startsWith('u0000') ? false : real(to, m));
      const r = await runWeeklyDigest(f.ports, NOW);
      expect(r).toMatchObject({ emailed: 4, failed: 1 });
    });
  });

  describe('Slack', () => {
    it('posts once a week, from an opted-in owner or admin’s view', async () => {
      const f = fake({ members: [{ userId: 'm' }, { userId: 'boss' }], channel: true, roles: { boss: 'owner' }, email: false });
      expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ slacked: 1 });
      expect(f.builtFor).toEqual(['boss']);
      expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ slacked: 0 });
      expect(f.posts).toHaveLength(1);
    });

    it('posts nothing when no owner or admin has the digest on (a channel has no recipient to scope to)', async () => {
      const f = fake({ members: [{ userId: 'm' }], channel: true, email: false });
      expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ slacked: 0, skipped: 1 });
      expect(f.channel.week).toBe('');
    });

    it('looks at no more than the capped number of members for an owner or admin', async () => {
      const f = fake({ members: Array.from({ length: 30 }, (_, i) => ({ userId: `m${String(i).padStart(2, '0')}` })).concat([{ userId: 'zz-boss' }]), channel: true, roles: { 'zz-boss': 'owner' }, email: false });
      let lookups = 0;
      const recipient = f.ports.recipient;
      f.ports.recipient = async (o, u) => { lookups += 1; return recipient(o, u); };
      expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ slacked: 0, skipped: 1 });
      expect(lookups).toBe(20);
    });

    it('a failed post releases the channel claim', async () => {
      const f = fake({ members: [{ userId: 'boss' }], channel: true, roles: { boss: 'admin' }, email: false, sendOk: false });
      expect(await runWeeklyDigest(f.ports, NOW)).toMatchObject({ slacked: 0, failed: 1 });
      expect(f.channel.week).toBe('');
    });
  });
});
