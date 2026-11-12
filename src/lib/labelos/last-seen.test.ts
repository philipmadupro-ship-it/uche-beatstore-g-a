import { describe, expect, it } from 'vitest';
import { memoryAdmin, type MemoryDb } from './mocks/memory-db';
import { markOverviewSeen, nextLastSeen, readLastSeenOverview } from './last-seen';

const U = '00000000-0000-4000-8000-0000000000a1';
const V = '00000000-0000-4000-8000-0000000000a2';
const A = '10000000-0000-4000-8000-00000000000a';
const B = '10000000-0000-4000-8000-00000000000b';
const NOW = new Date('2026-10-06T12:00:00Z');

describe('nextLastSeen', () => {
  it('takes `through` when nothing is stored', () => {
    expect(nextLastSeen(null, '2026-10-06T10:00:00Z', NOW)).toBe('2026-10-06T10:00:00.000Z');
  });
  it('never moves back', () => {
    expect(nextLastSeen('2026-10-06T11:00:00Z', '2026-10-06T10:00:00Z', NOW)).toBe('2026-10-06T11:00:00.000Z');
  });
  it('moves forward', () => {
    expect(nextLastSeen('2026-10-06T09:00:00Z', '2026-10-06T10:00:00Z', NOW)).toBe('2026-10-06T10:00:00.000Z');
  });
  it('never claims to have seen the future', () => {
    expect(nextLastSeen(null, '2027-01-01T00:00:00Z', NOW)).toBe('2026-10-06T12:00:00.000Z');
  });
});

const T = 'org_overview_seen';

function setup(seen: Record<string, unknown>[] = [], profiles: Record<string, unknown>[] = []) {
  const db: MemoryDb = {
    tables: { [T]: seen, user_profiles: profiles },
    unique: { [T]: [['org_id', 'user_id']], user_profiles: [['user_id']] },
  };
  const mem = memoryAdmin(db);
  return { db, admin: mem.client as never };
}

/** The same client, but the per-org table is not applied yet: PostgREST answers 42P01-ish for it. */
function setupWithoutTable(profiles: Record<string, unknown>[] = [], bare = false) {
  const { db, admin } = setup([], profiles);
  const real = admin as { from: (t: string) => unknown };
  const missing = () => {
    const chain: Record<string, unknown> = {};
    const err = { data: null, error: bare ? {} : { code: '42P01', message: `relation "public.${T}" does not exist` } };
    for (const m of ['select', 'update', 'insert', 'eq', 'lt', 'is', 'maybeSingle']) chain[m] = () => chain;
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(err).then(res);
    return chain;
  };
  return { db, admin: { from: (t: string) => (t === T ? missing() : real.from(t)) } as never };
}

describe('markOverviewSeen (per org)', () => {
  it('creates the (org, user) row when the member has none', async () => {
    const { db, admin } = setup();
    expect(await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: true, lastSeenAt: '2026-10-06T10:00:00.000Z' });
    expect(db.tables[T]).toEqual([expect.objectContaining({ org_id: A, user_id: U, last_seen_at: '2026-10-06T10:00:00.000Z' })]);
    expect(await readLastSeenOverview(admin, U, A)).toBe('2026-10-06T10:00:00.000Z');
  });

  it('visiting org A does not move org B’s mark, and not another member’s', async () => {
    const { db, admin } = setup([
      { org_id: A, user_id: U, last_seen_at: '2026-10-01T00:00:00.000Z' },
      { org_id: B, user_id: U, last_seen_at: '2026-10-01T00:00:00.000Z' },
      { org_id: A, user_id: V, last_seen_at: '2026-10-01T00:00:00.000Z' },
    ]);
    await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW);
    const at = (o: string, u: string) => db.tables[T].find((r) => r.org_id === o && r.user_id === u)?.last_seen_at;
    expect(at(A, U)).toBe('2026-10-06T10:00:00.000Z');
    expect(at(B, U)).toBe('2026-10-01T00:00:00.000Z');
    expect(at(A, V)).toBe('2026-10-01T00:00:00.000Z');
    expect(await readLastSeenOverview(admin, U, B)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('does not touch the user-level value once the table exists', async () => {
    const { db, admin } = setup([], [{ user_id: U, last_seen_overview_at: '2026-10-01T00:00:00.000Z' }]);
    await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW);
    expect(db.tables.user_profiles[0].last_seen_overview_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('an older tab cannot move the mark back', async () => {
    const { admin } = setup([{ org_id: A, user_id: U, last_seen_at: '2026-10-06T11:00:00.000Z' }]);
    expect(await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: true, lastSeenAt: '2026-10-06T11:00:00.000Z' });
  });

  it('reports a failed write instead of throwing', async () => {
    const admin = { from: () => { throw new Error('db down'); } } as never;
    expect(await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: false, error: 'db down' });
  });

  it('reads null for a member with no row in this org, whatever the user-level value', async () => {
    const { admin } = setup([], [{ user_id: U, last_seen_overview_at: '2026-10-01T00:00:00.000Z' }]);
    expect(await readLastSeenOverview(admin, U, A)).toBeNull();
  });
});

describe('before migration 169 is applied', () => {
  it('reads the user-level value', async () => {
    const { admin } = setupWithoutTable([{ user_id: U, last_seen_overview_at: '2026-10-01T00:00:00.000Z' }]);
    expect(await readLastSeenOverview(admin, U, A)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('writes the user-level value instead of failing', async () => {
    const { db, admin } = setupWithoutTable([{ user_id: U, last_seen_overview_at: '2026-10-01T00:00:00.000Z' }]);
    expect(await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: true, lastSeenAt: '2026-10-06T10:00:00.000Z' });
    expect(db.tables.user_profiles[0].last_seen_overview_at).toBe('2026-10-06T10:00:00.000Z');
  });

  it('falls back on PostgREST’s bare empty-404 answer too', async () => {
    const { db, admin } = setupWithoutTable([{ user_id: U, last_seen_overview_at: '2026-10-01T00:00:00.000Z' }], true);
    expect(await readLastSeenOverview(admin, U, A)).toBe('2026-10-01T00:00:00.000Z');
    expect(await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: true, lastSeenAt: '2026-10-06T10:00:00.000Z' });
    expect(db.tables.user_profiles[0].last_seen_overview_at).toBe('2026-10-06T10:00:00.000Z');
  });

  it('creates the profile row for a member who has none', async () => {
    const { db, admin } = setupWithoutTable();
    expect(await markOverviewSeen(admin, U, A, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: true, lastSeenAt: '2026-10-06T10:00:00.000Z' });
    expect(db.tables.user_profiles).toEqual([expect.objectContaining({ user_id: U })]);
  });
});
