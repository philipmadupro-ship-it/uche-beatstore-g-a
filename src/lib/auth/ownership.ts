/**
 * Server-side ownership checks for API routes that bypass RLS via the
 * service-role key. Several routes were assembling the cookie-client +
 * service-role pattern by hand and forgetting to verify that the caller
 * actually owns the row they're addressing — which let any authenticated
 * user read or mutate any other user's data by guessing IDs.
 *
 * These helpers consolidate the pattern: resolve the session, look up the
 * row's `user_id`, and either return the admin client or a short-circuit
 * `NextResponse` for the caller to bail with.
 *
 * Legacy rows where `user_id IS NULL` are not claimable through this helper.
 * They must be migrated to the producer explicitly rather than becoming
 * mutable by whichever authenticated user addresses the row first.
 */
import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export type AdminClient = ReturnType<typeof createServiceClient>;

// Switched from `require()` to top-level ESM import so vi.mock(...) can
// intercept @supabase/supabase-js in tests. The previous CommonJS require
// bypassed Vitest's module graph and made the ownership state machine
// untestable.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export type OwnershipOk = {
  ok: true;
  userId: string;
  admin: AdminClient;
};
export type OwnershipFail = { ok: false; res: NextResponse };
export type OwnershipResult = OwnershipOk | OwnershipFail;

/**
 * Resolve the caller and confirm they own a row in `table` with `id`.
 * Returns the admin client + user id for follow-up writes, or a 401/403/404
 * NextResponse the caller can return directly.
 */
export async function requireRowOwnership(
  table: string,
  id: string,
): Promise<OwnershipResult> {
  const cookieClient = await createServerClient();
  const { data: { user } } = await cookieClient.auth.getUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const admin = createServiceClient();
  const { data: row, error } = await admin
    .from(table)
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return { ok: false, res: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!row) {
    return { ok: false, res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  if (!row.user_id || row.user_id !== user.id) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId: user.id, admin };
}

/** Same shape as requireRowOwnership but only requires an authenticated user. */
export async function requireUser(): Promise<
  | { ok: true; userId: string; admin: AdminClient }
  | OwnershipFail
> {
  const cookieClient = await createServerClient();
  const { data: { user } } = await cookieClient.auth.getUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  return { ok: true, userId: user.id, admin: createServiceClient() };
}

/**
 * Validate a UUID before interpolating it into a PostgREST `.or()`
 * filter string. PostgREST treats commas inside `.or(...)` as
 * separators between conditions, so any comma in the value (or any
 * other PostgREST-special char that sneaks in via a bad caller) would
 * silently break the filter.
 *
 * `auth.users.id` and our owned-row PKs are UUIDs, so the strict shape
 * is the safest bound. Returns the id when it matches, null when it
 * doesn't (caller should treat null as "skip the scope clause").
 *
 * Use everywhere we build a PostgREST `.or('user_id.eq.${id},…')`
 * string by hand — even if today's source of `id` looks safe.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function safeSellerId(id: string | null | undefined): string | null {
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}
