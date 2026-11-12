/**
 * When this member last looked at an org's Overview digest (LABEL-20, made
 * per org by LABEL-46 / migration 169). One value per (org, user) in
 * `org_overview_seen`, so opening org A's Overview never clears org B's feed.
 * Read and written only through the service role (the table has no write
 * policy), and the user id is ALWAYS the session's, never a request's.
 *
 * Before 169 is applied the table does not exist: reads and writes fall back
 * to the old user-level `user_profiles.last_seen_overview_at` (migration 136),
 * so the Overview keeps working, with the old one-value-per-user behaviour.
 * Once the table exists the user-level column is left alone (it is the
 * backfill source and the fallback, never written again).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { errorMessage } from '@/lib/errors';

/** What to store: the later of what is stored and `through`, never later than `now`. Pure. */
export function nextLastSeen(existing: string | null, through: string, now: Date): string {
  const capped = Math.min(Date.parse(through), now.getTime());
  const prior = existing ? Date.parse(existing) : NaN;
  return new Date(Number.isNaN(prior) ? capped : Math.max(prior, capped)).toISOString();
}

/** Where one mark lives: its table, the columns that name its owner, and the timestamp column. */
type Slot = { table: string; keys: Record<string, string>; column: string; fallbackOnMissing: boolean };

/**
 * PostgREST names a missing table in a code or message, except that it
 * answers some requests (an INSERT into one) with an empty 404 that carries
 * neither: `isMissingSchema` cannot see that one, so a bare error counts too.
 */
function tableMissing(error: { code?: string; message?: string }): boolean {
  return isMissingSchema(error) || (!error.code && !error.message);
}

const orgSlot = (orgId: string, userId: string): Slot => ({
  table: 'org_overview_seen',
  keys: { org_id: orgId, user_id: userId },
  column: 'last_seen_at',
  fallbackOnMissing: true,
});
const userSlot = (userId: string): Slot => ({
  table: 'user_profiles',
  keys: { user_id: userId },
  column: 'last_seen_overview_at',
  fallbackOnMissing: false,
});

class SlotMissing extends Error {}

async function readSlot(admin: AdminClient, slot: Slot): Promise<string | null> {
  let q = admin.from(slot.table).select(slot.column);
  for (const [k, v] of Object.entries(slot.keys)) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) {
    if (slot.fallbackOnMissing && tableMissing(error)) throw new SlotMissing(error.message);
    throw new Error(`last seen read: ${error.message}`);
  }
  const v = (data as Record<string, unknown> | null)?.[slot.column];
  return typeof v === 'string' ? v : null;
}

/** The member's mark for this org, or null (never seen). Falls back to the user-level value before 169. */
export async function readLastSeenOverview(admin: AdminClient, userId: string, orgId: string): Promise<string | null> {
  try {
    return await readSlot(admin, orgSlot(orgId, userId));
  } catch (err) {
    if (!(err instanceof SlotMissing)) throw err;
    return readSlot(admin, userSlot(userId));
  }
}

export type MarkSeenResult = { ok: true; lastSeenAt: string } | { ok: false; error: string };

/**
 * Move one mark forward to `through`. Monotonic AND atomic: each write is one
 * conditional UPDATE, so two tabs posting different instants cannot leave the
 * older one stored. (Two plain filters, not an `or=`: PostgREST rejects `or=`
 * on a PATCH.) First `mark < next`; then `mark IS NULL`; when neither moves
 * anything either a mark at least as late is already stored (that is the
 * answer) or the row does not exist yet (insert; a concurrent insert, 23505,
 * means it now exists and the updates run once more).
 */
async function markSlot(admin: AdminClient, slot: Slot, through: string, now: Date): Promise<string> {
  const next = nextLastSeen(null, through, now);
  const patch = { [slot.column]: next, updated_at: now.toISOString() };
  const where = () => {
    let q = admin.from(slot.table).update(patch);
    for (const [k, v] of Object.entries(slot.keys)) q = q.eq(k, v);
    return q;
  };
  const moved = async (narrow: (q: ReturnType<typeof where>) => unknown) => {
    const res = (await narrow(where())) as { data: unknown[] | null; error: { message: string; code?: string } | null };
    if (res.error) {
      if (slot.fallbackOnMissing && tableMissing(res.error)) throw new SlotMissing(res.error.message);
      throw new Error(res.error.message);
    }
    return (res.data ?? []).length > 0;
  };
  const advance = async () =>
    (await moved((q) => q.lt(slot.column, next).select('user_id'))) || (await moved((q) => q.is(slot.column, null).select('user_id')));

  if (await advance()) return next;
  const stored = await readSlot(admin, slot);
  if (stored !== null) return new Date(stored).toISOString();
  const ins = await admin.from(slot.table).insert({ ...slot.keys, [slot.column]: next });
  if (ins.error) {
    if (slot.fallbackOnMissing && tableMissing(ins.error)) throw new SlotMissing(ins.error.message);
    if (ins.error.code !== '23505') throw new Error(ins.error.message);
    await advance();
    return new Date((await readSlot(admin, slot)) ?? next).toISOString();
  }
  return next;
}

/** Move the member's mark for THIS org forward to `through` (user-level before 169). */
export async function markOverviewSeen(admin: AdminClient, userId: string, orgId: string, through: string, now = new Date()): Promise<MarkSeenResult> {
  try {
    try {
      return { ok: true, lastSeenAt: await markSlot(admin, orgSlot(orgId, userId), through, now) };
    } catch (err) {
      if (!(err instanceof SlotMissing)) throw err;
      return { ok: true, lastSeenAt: await markSlot(admin, userSlot(userId), through, now) };
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
