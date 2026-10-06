/**
 * `user_profiles.last_seen_overview_at` (migration 136, LABEL-20): when this
 * member last looked at the org Overview's digest. Read for the signed-in
 * user's own row and written only by `POST /api/org/[orgId]/overview/seen`,
 * through the service role (the table has a SELECT policy and no write
 * policy): the user id is ALWAYS the session's, never a request's.
 *
 * It is one value per USER, not per org (the column is on user_profiles),
 * so opening one org's Overview also marks the digest of every other org
 * seen. Carried to the product owner in the LABEL-20 notes; a per-org value
 * would need a table or a jsonb column, which this task's "one column" scope
 * does not include.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

/** What to store: the later of what is stored and `through`, never later than `now`. Pure. */
export function nextLastSeen(existing: string | null, through: string, now: Date): string {
  const capped = Math.min(Date.parse(through), now.getTime());
  const prior = existing ? Date.parse(existing) : NaN;
  return new Date(Number.isNaN(prior) ? capped : Math.max(prior, capped)).toISOString();
}

export async function readLastSeenOverview(admin: AdminClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from('user_profiles').select('last_seen_overview_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`last seen read: ${error.message}`);
  const v = (data as { last_seen_overview_at?: unknown } | null)?.last_seen_overview_at;
  return typeof v === 'string' ? v : null;
}

export type MarkSeenResult = { ok: true; lastSeenAt: string } | { ok: false; error: string };

/**
 * Move the member's mark forward to `through`. Monotonic AND atomic: each write
 * is one conditional UPDATE, so two tabs posting different instants cannot
 * leave the older one stored. (Two plain filters, not an `or=`: PostgREST
 * rejects `or=` on a PATCH.) First `mark < next`; then `mark IS NULL`; when
 * neither moves anything either a mark at least as late is already stored
 * (that is the answer) or the member has no profile row yet (insert; a
 * concurrent insert, 23505, means it now exists and the updates run once more).
 */
export async function markOverviewSeen(admin: AdminClient, userId: string, through: string, now = new Date()): Promise<MarkSeenResult> {
  try {
    const next = nextLastSeen(null, through, now);
    const patch = { last_seen_overview_at: next, updated_at: now.toISOString() };
    const moved = async (narrow: (q: ReturnType<typeof base>) => unknown) => {
      const res = (await narrow(base())) as { data: unknown[] | null; error: { message: string } | null };
      if (res.error) throw new Error(res.error.message);
      return (res.data ?? []).length > 0;
    };
    const base = () => admin.from('user_profiles').update(patch).eq('user_id', userId);
    const advance = async () =>
      (await moved((q) => q.lt('last_seen_overview_at', next).select('user_id'))) ||
      (await moved((q) => q.is('last_seen_overview_at', null).select('user_id')));

    if (await advance()) return { ok: true, lastSeenAt: next };
    const stored = await readLastSeenOverview(admin, userId);
    if (stored !== null) return { ok: true, lastSeenAt: new Date(stored).toISOString() };
    const ins = await admin.from('user_profiles').insert({ user_id: userId, last_seen_overview_at: next });
    if (ins.error) {
      if (ins.error.code !== '23505') throw new Error(ins.error.message);
      await advance();
      const now2 = await readLastSeenOverview(admin, userId);
      return { ok: true, lastSeenAt: new Date(now2 ?? next).toISOString() };
    }
    return { ok: true, lastSeenAt: next };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
