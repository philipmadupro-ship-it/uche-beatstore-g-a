import { beforeEach, describe, expect, it } from 'vitest';
import { memoryAdmin, type MemoryDb } from './mocks/memory-db';
import { gatherOrgExport, dueOrgs, pruneOldEvents, purgeOrg, restoreOrg, softDeleteOrg } from './org-lifecycle-store';
import { AUDIT_VERBS } from './activity';
import { FEED_EVENT_VERBS, feedState } from './feed-token';

const A = '10000000-0000-4000-8000-00000000000a'; // the org under test
const B = '10000000-0000-4000-8000-00000000000b'; // another org
const U = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PA = '40000000-0000-4000-8000-0000000000a1';
const PB = '40000000-0000-4000-8000-0000000000b1';
const PROD = '40000000-0000-4000-8000-0000000000c1'; // a producer's project (org_id null)
const TA = '50000000-0000-4000-8000-0000000000a1';
const TB = '50000000-0000-4000-8000-0000000000b1';
const TPROD = '50000000-0000-4000-8000-0000000000c1';

const NOW = new Date('2026-10-13T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

function seed(): MemoryDb {
  return {
    tables: {
      organizations: [
        { id: A, name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: daysAgo(31) },
        { id: B, name: 'Other', slug: 'other', kind: 'label', deleted_at: null },
      ],
      org_members: [
        { org_id: A, user_id: U(1), role: 'owner' },
        { org_id: B, user_id: U(2), role: 'owner' },
      ],
      org_invitations: [
        { id: 'i1', org_id: A, email: 'x@y.z', token_hash: 'SECRET', role: 'member' },
        { id: 'i2', org_id: B, email: 'q@y.z', token_hash: 'SECRET2', role: 'member' },
      ],
      member_artist_scopes: [],
      contacts: [{ id: 'c1', org_id: A, name: 'Nova' }, { id: 'c2', org_id: B, name: 'Elsewhere' }, { id: 'c3', org_id: null, user_id: U(9), name: 'Producer contact' }],
      projects: [
        { id: PA, org_id: A, name: 'EP' },
        { id: PB, org_id: B, name: 'Other EP' },
        { id: PROD, org_id: null, user_id: U(9), name: 'Producer project' },
      ],
      tracks: [
        { id: TA, org_id: A, title: 'Midnight', audio_url: 'r2://priv/orgs/' + A + '/tracks/a.wav' },
        { id: TB, org_id: B, title: 'Elsewhere', audio_url: 'r2://priv/orgs/' + B + '/tracks/b.wav' },
        { id: TPROD, org_id: null, user_id: U(9), title: 'Beat' },
      ],
      project_tracks: [
        { project_id: PA, track_id: TA },
        { project_id: PB, track_id: TB },
        { project_id: PROD, track_id: TPROD },
      ],
      project_contacts: [],
      project_assets: [],
      project_comments: [],
      project_members: [],
      track_links: [{ from_track_id: TA, to_track_id: TA, relation: 'version' }, { from_track_id: TB, to_track_id: TB, relation: 'version' }],
      song_beats: [],
      track_tags: [{ track_id: TA, tag: 'dark' }, { track_id: TPROD, tag: 'trap' }],
      stems: [],
      song_reviews: [],
      releases: [],
      release_items: [],
      tasks: [],
      activity_events: [],
    },
  };
}

beforeEach(() => {
  db = seed();
  mem = memoryAdmin(db);
});

describe('gatherOrgExport', () => {
  it('returns the org’s rows and their children, never another org’s or a producer’s', async () => {
    db.tables.organizations[0].deleted_at = null;
    const t = await gatherOrgExport(mem.client as never, A);
    expect(t.organizations.map((r) => r.id)).toEqual([A]);
    expect(t.org_members.map((r) => r.user_id)).toEqual([U(1)]);
    expect(t.contacts.map((r) => r.id)).toEqual(['c1']);
    expect(t.projects.map((r) => r.id)).toEqual([PA]);
    expect(t.tracks.map((r) => r.id)).toEqual([TA]);
    expect(t.project_tracks).toEqual([{ project_id: PA, track_id: TA }]);
    expect(t.track_links.map((r) => r.from_track_id)).toEqual([TA]);
    expect(t.track_tags).toEqual([{ track_id: TA, tag: 'dark' }]);
    expect(JSON.stringify(t)).not.toContain(PB);
    expect(JSON.stringify(t)).not.toContain(PROD);
    expect(JSON.stringify(t)).not.toContain('Producer');
  });

  it('never carries an invitation’s secret', async () => {
    const t = await gatherOrgExport(mem.client as never, A);
    expect(t.org_invitations).toEqual([{ id: 'i1', org_id: A, email: 'x@y.z', role: 'member' }]);
    expect(JSON.stringify(t)).not.toContain('SECRET');
  });

  it('pages through more rows than one request returns', async () => {
    for (let i = 0; i < 2300; i += 1) db.tables.activity_events.push({ id: `e${String(i).padStart(5, '0')}`, org_id: A, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), verb: 'song.created', audit: false });
    const t = await gatherOrgExport(mem.client as never, A);
    expect(t.activity_events).toHaveLength(2300);
  });

  it('is read-only', async () => {
    await gatherOrgExport(mem.client as never, A);
    expect(mem.writes).toEqual([]);
  });
});

describe('soft delete and restore', () => {
  it('stamps a live org once and refuses a second time', async () => {
    expect(await softDeleteOrg(mem.client as never, B, NOW)).toBe(NOW.toISOString());
    expect(db.tables.organizations.find((o) => o.id === B)!.deleted_at).toBe(NOW.toISOString());
    expect(await softDeleteOrg(mem.client as never, B, new Date('2026-10-14T00:00:00Z'))).toBeNull();
    expect(db.tables.organizations.find((o) => o.id === B)!.deleted_at).toBe(NOW.toISOString());
  });

  it('restores only the stamp it was given', async () => {
    await softDeleteOrg(mem.client as never, B, NOW);
    expect(await restoreOrg(mem.client as never, B, '2020-01-01T00:00:00.000Z')).toBe(false);
    expect(await restoreOrg(mem.client as never, B, NOW.toISOString())).toBe(true);
    expect(db.tables.organizations.find((o) => o.id === B)!.deleted_at).toBeNull();
  });

  it('touches nothing but the one org row', async () => {
    await softDeleteOrg(mem.client as never, B, NOW);
    expect(mem.writes.map((w) => w.table)).toEqual(['organizations']);
    expect(db.tables.organizations.find((o) => o.id === A)!.deleted_at).toBe(daysAgo(31));
  });
});

describe('dueOrgs', () => {
  it('lists only orgs deleted 30 days ago or more, oldest first', async () => {
    db.tables.organizations.push(
      { id: 'c', name: 'Old', slug: 'old', kind: 'label', deleted_at: daysAgo(90) },
      { id: 'd', name: 'Recent', slug: 'recent', kind: 'label', deleted_at: daysAgo(29) },
      { id: 'e', name: 'Edge', slug: 'edge', kind: 'label', deleted_at: daysAgo(30) },
    );
    expect((await dueOrgs(mem.client as never, NOW)).map((o) => o.id)).toEqual(['c', A, 'e']);
  });

  it('respects the limit', async () => {
    expect(await dueOrgs(mem.client as never, NOW, 0 + 1)).toHaveLength(1);
  });
});

describe('purgeOrg', () => {
  it('deletes the objects first, then the row, and reports both', async () => {
    const order: string[] = [];
    const out = await purgeOrg(mem.client as never, { id: A, name: 'Night Shift', deleted_at: daysAgo(31) }, async (id) => {
      order.push(`objects:${id}`);
      // The row is still there while the objects go.
      expect(db.tables.organizations.some((o) => o.id === A)).toBe(true);
      return 4;
    }, NOW);
    expect(out).toEqual({ status: 'purged', orgId: A, objects: 4 });
    expect(order).toEqual([`objects:${A}`]);
    expect(db.tables.organizations.map((o) => o.id)).toEqual([B]);
  });

  it('keeps the row when the objects cannot be deleted, so tomorrow retries', async () => {
    const out = await purgeOrg(mem.client as never, { id: A, name: 'x', deleted_at: daysAgo(31) }, async () => {
      throw new Error('AccessDenied');
    }, NOW);
    expect(out).toMatchObject({ status: 'kept', orgId: A });
    expect(db.tables.organizations.some((o) => o.id === A)).toBe(true);
    expect(mem.writes).toEqual([]);
  });

  it('does not delete an org that was restored, or is not yet due, between listing and purging', async () => {
    db.tables.organizations[0].deleted_at = null; // restored
    expect(await purgeOrg(mem.client as never, { id: A, name: 'x', deleted_at: daysAgo(31) }, async () => 0, NOW)).toMatchObject({ status: 'kept', reason: 'no longer due' });
    db.tables.organizations[0].deleted_at = daysAgo(5); // deleted again, recently
    expect(await purgeOrg(mem.client as never, { id: A, name: 'x', deleted_at: daysAgo(31) }, async () => 0, NOW)).toMatchObject({ status: 'kept' });
    expect(db.tables.organizations.some((o) => o.id === A)).toBe(true);
  });

  it('never deletes a live org even when asked to', async () => {
    const out = await purgeOrg(mem.client as never, { id: B, name: 'Other', deleted_at: daysAgo(40) }, async () => 0, NOW);
    expect(out).toMatchObject({ status: 'kept' });
    expect(db.tables.organizations.some((o) => o.id === B)).toBe(true);
  });

  it('removes exactly one organization row and no other table', async () => {
    await purgeOrg(mem.client as never, { id: A, name: 'x', deleted_at: daysAgo(31) }, async () => 0, NOW);
    expect(mem.writes.map((w) => `${w.table}:${w.op}:${w.rows.length}`)).toEqual(['organizations:delete:1']);
    // Everything else — the other org's rows and the producer's — is exactly where it was.
    expect(db.tables.tracks.map((t) => t.id)).toEqual([TA, TB, TPROD]);
    expect(db.tables.projects.map((p) => p.id)).toEqual([PA, PB, PROD]);
  });
});

describe('pruneOldEvents (D9)', () => {
  const ev = (id: string, over: Record<string, unknown>) => ({ id, org_id: A, verb: 'song.created', audit: false, created_at: daysAgo(30), ...over });

  it('removes everyday events older than 24 months and nothing else', async () => {
    db.tables.activity_events.push(
      ev('old-plain', { created_at: '2024-01-01T00:00:00Z' }),
      ev('old-other-org', { org_id: B, created_at: '2023-06-01T00:00:00Z' }),
      ev('old-audit', { verb: 'member.removed', audit: true, created_at: '2023-01-01T00:00:00Z' }),
      ev('old-audit-verb-unflagged', { verb: 'share.created', audit: false, created_at: '2023-01-01T00:00:00Z' }),
      ev('recent-plain', { created_at: daysAgo(100) }),
      ev('just-inside', { created_at: '2024-10-14T00:00:00Z' }),
    );
    const r = await pruneOldEvents(mem.client as never, NOW);
    expect(r).toMatchObject({ deleted: 2, more: false, cutoff: '2024-10-13T12:00:00.000Z' });
    expect(db.tables.activity_events.map((e) => e.id).sort()).toEqual(['just-inside', 'old-audit', 'old-audit-verb-unflagged', 'recent-plain']);
  });

  it('every audit verb is protected even if its row was written unflagged', async () => {
    for (const v of AUDIT_VERBS) db.tables.activity_events.push(ev(`a-${v}`, { verb: v, audit: false, created_at: '2020-01-01T00:00:00Z' }));
    expect((await pruneOldEvents(mem.client as never, NOW)).deleted).toBe(0);
    expect(db.tables.activity_events).toHaveLength(AUDIT_VERBS.length);
  });

  it('retention can never revive a revoked calendar link (LABEL-34): the feed verbs are audit verbs and the prune keeps them, flagged or not', async () => {
    for (const v of FEED_EVENT_VERBS) expect(AUDIT_VERBS, v).toContain(v);
    db.tables.activity_events.push(
      ev('f1', { verb: 'calendar_feed.issued', audit: true, actor_id: 'u1', created_at: '2019-01-01T00:00:00Z' }),
      ev('f2', { verb: 'calendar_feed.revoked', audit: false, actor_id: 'u1', created_at: '2019-02-01T00:00:00Z' }),
      ev('old-plain', { created_at: '2019-03-01T00:00:00Z' }),
    );
    const verbsOf = () =>
      db.tables.activity_events
        .filter((e) => e.actor_id === 'u1')
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((e) => String(e.verb));
    const before = feedState(verbsOf());
    expect(before).toEqual({ active: false, version: 2 });
    expect((await pruneOldEvents(mem.client as never, NOW)).deleted).toBe(1);
    expect(feedState(verbsOf())).toEqual(before);
  });

  it('is idempotent', async () => {
    db.tables.activity_events.push(ev('old', { created_at: '2020-01-01T00:00:00Z' }));
    expect((await pruneOldEvents(mem.client as never, NOW)).deleted).toBe(1);
    expect((await pruneOldEvents(mem.client as never, NOW)).deleted).toBe(0);
  });

  it('works through a backlog in batches and says when it stopped early', async () => {
    for (let i = 0; i < 1200; i += 1) db.tables.activity_events.push(ev(`o${i}`, { created_at: '2020-01-01T00:00:00Z' }));
    const r = await pruneOldEvents(mem.client as never, NOW);
    expect(r).toMatchObject({ deleted: 1200, more: false });
    expect(db.tables.activity_events).toHaveLength(0);
  });
});
