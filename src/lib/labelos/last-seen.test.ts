import { describe, expect, it } from 'vitest';
import { memoryAdmin, type MemoryDb } from './mocks/memory-db';
import { markOverviewSeen, nextLastSeen, readLastSeenOverview } from './last-seen';

const U = '00000000-0000-4000-8000-0000000000a1';
const V = '00000000-0000-4000-8000-0000000000a2';
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

function setup(rows: Record<string, unknown>[] = []) {
  const db: MemoryDb = { tables: { user_profiles: rows }, unique: { user_profiles: [['user_id']] } };
  const mem = memoryAdmin(db);
  return { db, admin: mem.client as never };
}

describe('markOverviewSeen', () => {
  it('creates the profile row when the member has none', async () => {
    const { db, admin } = setup();
    expect(await markOverviewSeen(admin, U, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: true, lastSeenAt: '2026-10-06T10:00:00.000Z' });
    expect(db.tables.user_profiles).toHaveLength(1);
    expect(await readLastSeenOverview(admin, U)).toBe('2026-10-06T10:00:00.000Z');
  });

  it('updates an existing row, only the caller’s', async () => {
    const { db, admin } = setup([
      { user_id: U, display_name: 'Ana', last_seen_overview_at: '2026-10-01T00:00:00Z' },
      { user_id: V, display_name: 'Vic', last_seen_overview_at: '2026-10-01T00:00:00Z' },
    ]);
    await markOverviewSeen(admin, U, '2026-10-06T10:00:00Z', NOW);
    expect(db.tables.user_profiles.map((r) => [r.user_id, r.last_seen_overview_at])).toEqual([
      [U, '2026-10-06T10:00:00.000Z'],
      [V, '2026-10-01T00:00:00Z'],
    ]);
    expect(db.tables.user_profiles[0].display_name).toBe('Ana');
  });

  it('an older tab cannot move the mark back', async () => {
    const { admin } = setup([{ user_id: U, last_seen_overview_at: '2026-10-06T11:00:00Z' }]);
    const r = await markOverviewSeen(admin, U, '2026-10-06T10:00:00Z', NOW);
    expect(r).toEqual({ ok: true, lastSeenAt: '2026-10-06T11:00:00.000Z' });
  });

  it('reports a failed write instead of throwing', async () => {
    const admin = { from: () => { throw new Error('db down'); } } as never;
    expect(await markOverviewSeen(admin, U, '2026-10-06T10:00:00Z', NOW)).toEqual({ ok: false, error: 'db down' });
  });

  it('reads null for a member with no row', async () => {
    const { admin } = setup();
    expect(await readLastSeenOverview(admin, U)).toBeNull();
  });
});
