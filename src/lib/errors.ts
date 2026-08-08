/**
 * Tiny error-handling utilities.
 *
 * Before: every catch block did
 *   catch (error: any) { ...error.message... }
 * which gets flagged by @typescript-eslint/no-explicit-any (set to
 * `error` in this repo) and also hides real bugs — `error.message` is
 * undefined when the thrown thing isn't an Error.
 *
 * Pattern going forward:
 *   catch (err) { return NextResponse.json({ error: errorMessage(err) }, ...) }
 *
 * Equivalent ergonomics, no `any`, and gracefully handles the surprisingly
 * common case of `throw 'string'` or `throw { code: 'XYZ' }` deeper in
 * the call stack.
 */

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err === null || err === undefined) {
    // JSON.stringify(undefined) returns the value `undefined` (not the
    // string "undefined"), which would break this function's return-type
    // contract. Handle both null/undefined up front.
    return String(err);
  }
  if (typeof err === 'object') {
    // Supabase errors come back as { message, details, hint, code } —
    // the message is the only field we ever surface, so prefer it.
    const e = err as { message?: unknown };
    if (typeof e.message === 'string') return e.message;
  }
  try {
    const s = JSON.stringify(err);
    // JSON.stringify can still return `undefined` for functions / symbols.
    return typeof s === 'string' ? s : String(err);
  } catch {
    return String(err);
  }
}

export function isError(x: unknown): x is Error {
  return x instanceof Error;
}

/* ── Missing-migration errors ──────────────────────────────────────────
 *
 * Turning "Could not find the 'x' column in the schema cache" into something
 * a human can act on.
 *
 * This is the single most common failure in this codebase's deploy story:
 * code ships, its migration has not been applied, and PostgREST answers with
 * a message written for whoever is debugging PostgREST. It has surfaced
 * verbatim in the UI three times running (migrations 106, 107, 108), each
 * time as an unexplained red toast during an action that had otherwise
 * appeared to work.
 *
 * The information needed to explain it is already in the error (the column)
 * and already in the repo (which migration adds it), so map one to the other
 * and state the actual next step.
 *
 * Lives here rather than in a `lib/errors/` directory: `lib/errors.ts` is
 * already a module, and a sibling folder of the same name makes
 * `@/lib/errors` resolve on bundler-specific precedence rules.
 */
/** Columns a UI action writes, and the migration that introduces them. */
const COLUMN_MIGRATIONS: Record<string, string> = {
  // 106 — default artwork + brand palette
  default_artwork_url: '109_default_artwork',
  default_artwork_palette: '109_default_artwork',
  // 108 — logo + per-kind artwork
  logo_url: '108_brand_logo_and_kind_artwork',
  default_artwork_project_url: '108_brand_logo_and_kind_artwork',
  default_artwork_project_palette: '108_brand_logo_and_kind_artwork',
  default_artwork_playlist_url: '108_brand_logo_and_kind_artwork',
  default_artwork_playlist_palette: '108_brand_logo_and_kind_artwork',
};

/** Tables a UI action writes, and the migration that creates them. */
const TABLE_MIGRATIONS: Record<string, string> = {
  tag_colors: '107_tag_colors',
};

/**
 * Extract the column PostgREST complained about.
 *
 * Matches the two shapes it actually emits — the schema-cache message and the
 * "column ... does not exist" one Postgres itself raises when the cache is
 * warm but the column truly is absent.
 */
export function missingColumnFrom(message: string): string | null {
  const cache = /Could not find the '([^']+)' column/i.exec(message);
  if (cache) return cache[1];
  const pg = /column "?([a-z0-9_.]+)"? does not exist/i.exec(message);
  if (pg) return pg[1].split('.').pop() ?? null;
  return null;
}

/** Extract the table, for "relation does not exist" / missing-table cache misses. */
export function missingTableFrom(message: string): string | null {
  const cache = /Could not find the table '(?:public\.)?([a-z0-9_]+)'/i.exec(message);
  if (cache) return cache[1];
  const pg = /relation "(?:public\.)?([a-z0-9_]+)" does not exist/i.exec(message);
  if (pg) return pg[1];
  return null;
}

/**
 * A message worth showing a producer, or null if this is not a schema problem.
 *
 * Returning null rather than a fallback string matters: the caller must be
 * able to tell "this is a missing migration" from "this is some other failure"
 * so it does not tell someone to run a migration for an expired session.
 */
export function schemaCacheMessage(err: unknown): string | null {
  const message = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string')
      ? (err as { message: string }).message
      : '';
  if (!message) return null;

  const table = missingTableFrom(message);
  if (table) {
    const migration = TABLE_MIGRATIONS[table];
    return migration
      ? `This feature needs a database update that hasn't been applied yet (migration ${migration}). Run it on Supabase, wait a few seconds, then try again.`
      : `This feature needs a database table (${table}) that hasn't been created yet. Apply the pending migrations on Supabase and try again.`;
  }

  const column = missingColumnFrom(message);
  if (column) {
    const migration = COLUMN_MIGRATIONS[column];
    return migration
      ? `This feature needs a database update that hasn't been applied yet (migration ${migration}). Run it on Supabase, wait a few seconds, then try again.`
      : `This feature needs a database column (${column}) that hasn't been added yet. Apply the pending migrations on Supabase and try again.`;
  }

  return null;
}
