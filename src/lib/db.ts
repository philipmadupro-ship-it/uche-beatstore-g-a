/**
 * Storage facade.
 *
 * Every API route in this codebase used to branch like this:
 *
 *   if (isSupabaseConfigured()) {
 *     // 40 lines: cookie client → get user → service-role admin → filter
 *     // by user_id → maybe a join → maybe an ownership check → respond
 *   } else {
 *     // 20 lines: local-store equivalent with the same filter expressed
 *     // as JS predicates
 *   }
 *
 * Two problems with that:
 *   (a) Both branches drift — a column rename or a new RLS constraint
 *       lands in one and not the other (the `beat_sends.sent_at` bug
 *       that just killed the contacts page is exactly this).
 *   (b) The auth-and-ownership wiring is copy-pasted; new routes forget
 *       a step and end up over-permissive (we found 10 such routes in
 *       the security audit).
 *
 * This module is the single place where the dispatch + ownership + user
 * filter logic lives. Routes stay explicit about *what* they want (so we
 * don't lose flexibility for joins/orders/specials), but the boilerplate
 * around their query is centralized.
 *
 * Naming convention: helpers prefixed with `scoped` apply the
 * "user owns this row OR row is null-owner legacy" filter automatically.
 * Helpers prefixed with `unscoped` skip it for public surfaces. Helpers
 * suffixed with `Owned` require ownership before touching the row.
 *
 * Local-store branch ALWAYS calls through `lib/local-store.ts` so the dev
 * fallback continues to work for offline / pre-Supabase development.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceClient, requireRowOwnership, requireUser } from '@/lib/auth/ownership';
import {
  isSupabaseConfigured,
  getAll,
  getById,
  insert,
  update,
  deleteRow,
  query,
} from '@/lib/local-store';

// Re-export so route files have one import surface — most routes need a
// handful of these together.
export { requireRowOwnership, requireUser, createServiceClient, isSupabaseConfigured };

// =====================================================================
// Types
// =====================================================================

// Tables that have a `user_id` column. Listing them explicitly catches
// typos at compile time — `scopedList('treacks', ...)` would fail to
// build instead of failing silently at runtime. Every member is also a
// key of DBSchema (local-store), so the local-store passthroughs below
// don't need an `as any` cast.
type OwnedTable =
  | 'tracks'
  | 'playlists'
  | 'projects'
  | 'contacts'
  | 'calendar_events'
  | 'share_links'
  | 'smart_playlists'
  | 'project_folders';

// Cheap shape we accept for local-store rows. Every row has at minimum an
// `id`; everything else is dynamic-shaped (different per table). This
// lets us drop `any` while still letting callers narrow with a generic.
type LocalRow = { id: string; [k: string]: unknown };

interface ListOptions {
  /**
   * Extra `.select(...)` string — same syntax as supabase-js. e.g.
   * `'*, track_tags(tag), stems(status)'`.
   */
  select?: string;
  /** Column to order by. */
  orderBy?: string;
  /** Default ascending false (newest first). */
  ascending?: boolean;
  /**
   * Whether to include legacy `user_id IS NULL` rows in the scoped list.
   * Defaults to true (demo content stays visible). Pass `false` for
   * routes that should be strictly per-user.
   */
  includeNullOwner?: boolean;
  /** Optional extra filters applied AFTER the user-scope filter. */
  extraEq?: Record<string, string | number | boolean>;
  /** Greater-than-or-equal filters (column → threshold). */
  extraGte?: Record<string, number>;
  /** Less-than-or-equal filters. */
  extraLte?: Record<string, number>;
  /** `.in(column, values)` filter. */
  extraIn?: { column: string; values: (string | number)[] };
}

// =====================================================================
// Auth-gated dispatch helpers
// =====================================================================

/**
 * Run one of two functions depending on whether Supabase is configured.
 * Keeps route code linear instead of nested-if. Both branches must
 * return the same shape — usually a NextResponse.
 *
 * Example:
 *   return withBackend(
 *     async () => { ... Supabase branch ... },
 *     () => { ... local-store branch ... },
 *   );
 */
export async function withBackend<T>(
  supabase: () => Promise<T>,
  local: () => T | Promise<T>,
): Promise<T> {
  if (isSupabaseConfigured()) return supabase();
  return local();
}

// =====================================================================
// Scoped list — user_id = me OR null
// =====================================================================

/**
 * Return rows from `table` filtered to the caller's owned rows + (by
 * default) null-owner legacy rows. Unauthenticated callers get the
 * cookie-client fallback so they still see whatever RLS lets through.
 *
 * Routes use it like:
 *   const rows = await scopedList('tracks', {
 *     orderBy: 'created_at', ascending: false,
 *     select: '*, track_tags(tag), stems(status)',
 *   });
 *
 * Returns the rows OR a `NextResponse` if something failed (the caller
 * can short-circuit by checking `Array.isArray`).
 */
export async function scopedList<T = unknown>(
  table: OwnedTable,
  opts: ListOptions = {},
): Promise<T[] | NextResponse> {
  const {
    select = '*',
    orderBy = 'created_at',
    ascending = false,
    includeNullOwner = true,
    extraEq,
    extraGte,
    extraLte,
    extraIn,
  } = opts;

  if (!isSupabaseConfigured()) {
    let rows = getAll(table) as LocalRow[];
    if (extraEq) {
      for (const [k, v] of Object.entries(extraEq)) {
        rows = rows.filter((r) => r[k] === v);
      }
    }
    if (extraGte) {
      for (const [k, v] of Object.entries(extraGte)) {
        rows = rows.filter((r) => (Number(r[k]) || 0) >= v);
      }
    }
    if (extraLte) {
      for (const [k, v] of Object.entries(extraLte)) {
        rows = rows.filter((r) => (Number(r[k]) || 0) <= v);
      }
    }
    if (extraIn) {
      const set = new Set(extraIn.values.map(String));
      rows = rows.filter((r) => set.has(String(r[extraIn.column])));
    }
    return rows.sort((a, b) => {
      const av = a[orderBy] ?? '';
      const bv = b[orderBy] ?? '';
      const cmp = String(av).localeCompare(String(bv));
      return ascending ? cmp : -cmp;
    }) as T[];
  }

  const cookieClient = await createServerClient();
  const { data: { user } } = await cookieClient.auth.getUser();
  const supabase = user ? createServiceClient() : cookieClient;

  let q = supabase.from(table).select(select).order(orderBy, { ascending });
  if (user) {
    if (includeNullOwner) {
      q = q.or(`user_id.eq.${user.id},user_id.is.null`);
    } else {
      q = q.eq('user_id', user.id);
    }
  }
  if (extraEq) {
    for (const [k, v] of Object.entries(extraEq)) {
      q = q.eq(k, v);
    }
  }
  if (extraGte) {
    for (const [k, v] of Object.entries(extraGte)) {
      q = q.gte(k, v);
    }
  }
  if (extraLte) {
    for (const [k, v] of Object.entries(extraLte)) {
      q = q.lte(k, v);
    }
  }
  if (extraIn) {
    q = q.in(extraIn.column, extraIn.values);
  }
  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return (data ?? []) as T[];
}

// =====================================================================
// Owned-row helpers — get/update/delete with the ownership check baked in
// =====================================================================

interface OwnedReadOptions {
  select?: string;
}

/**
 * Read a single row by id, verifying the caller owns it (or it's a
 * null-owner legacy row). Returns the row or a NextResponse the caller
 * can return directly.
 */
export async function getOwned<T = unknown>(
  table: OwnedTable,
  id: string,
  opts: OwnedReadOptions = {},
): Promise<T | NextResponse> {
  if (!isSupabaseConfigured()) {
    const row = getById(table, id) as LocalRow | null;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return row as T;
  }

  const owner = await requireRowOwnership(table, id);
  if (!owner.ok) return owner.res;
  const { data, error } = await owner.admin
    .from(table)
    .select(opts.select ?? '*')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return (data ?? null) as T;
}

/**
 * Patch a single row after ownership check. Strips `id` and `user_id`
 * from the patch automatically — those are never client-controlled.
 * Stamps `updated_at` when the column exists.
 */
export async function updateOwned<T = unknown>(
  table: OwnedTable,
  id: string,
  patch: Record<string, unknown>,
  opts: OwnedReadOptions & { stampUpdatedAt?: boolean } = {},
): Promise<T | NextResponse> {
  const safePatch = { ...patch };
  delete safePatch.id;
  delete safePatch.user_id;
  if (opts.stampUpdatedAt) safePatch.updated_at = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    const row = update(table, id, safePatch);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return row as T;
  }

  const owner = await requireRowOwnership(table, id);
  if (!owner.ok) return owner.res;
  const { data, error } = await owner.admin
    .from(table)
    .update(safePatch)
    .eq('id', id)
    .select(opts.select ?? '*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data as T;
}

/**
 * Hard-delete after ownership check.
 */
export async function deleteOwned(
  table: OwnedTable,
  id: string,
): Promise<true | NextResponse> {
  if (!isSupabaseConfigured()) {
    deleteRow(table, id);
    return true;
  }
  const owner = await requireRowOwnership(table, id);
  if (!owner.ok) return owner.res;
  const { error } = await owner.admin.from(table).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return true;
}

// =====================================================================
// Inserts that stamp user_id automatically
// =====================================================================

/**
 * Insert a row, stamping the caller's user_id automatically. Use for
 * tables where every row must belong to a user. Returns the inserted
 * row OR a NextResponse if the caller isn't authenticated.
 */
export async function insertOwned<T = unknown>(
  table: OwnedTable,
  payload: Record<string, unknown>,
  opts: { select?: string } = {},
): Promise<T | NextResponse> {
  if (!isSupabaseConfigured()) {
    const row = insert(table, { ...payload, user_id: 'local-user' });
    return row as T;
  }

  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const row = { ...payload, user_id: auth.userId };
  const { data, error } = await auth.admin
    .from(table)
    .insert(row)
    .select(opts.select ?? '*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data as T;
}

// =====================================================================
// Local-store passthrough for non-owned tables
// =====================================================================

// Many junction tables (track_tags, playlist_tracks, project_tracks) don't
// have a user_id column — their ownership flows through the parent. For
// those, routes still call the existing local-store helpers directly. We
// re-export them so route files have one import.
export { getAll, getById, query, insert, update, deleteRow };

// =====================================================================
// Convenience: detect whether a `scopedList` result is the error response
// =====================================================================

/** Type guard: facade returns either rows or a NextResponse. */
export function isErrorResponse(r: unknown): r is NextResponse {
  return r instanceof NextResponse;
}
