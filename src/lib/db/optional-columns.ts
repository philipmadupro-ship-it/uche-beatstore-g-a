/**
 * Tolerate columns that exist in the code but not yet in the database.
 *
 * WHY THIS EXISTS. Adding `tracks.bands_url` to a `select(...)` list made the
 * whole query fail with `column tracks.bands_url does not exist` on any
 * deployment where migration 105 had not been applied yet — and a failed select
 * is not a degraded feature, it is an EMPTY LIBRARY. Caught in the browser: the
 * dashboard showed "LIBRARY · 0" with a full catalogue sitting in the database.
 *
 * The project rule is to apply migrations before merging dependent code, and
 * that rule stands. But code and schema deploy at different instants no matter
 * how careful the ordering is, and during that window the failure mode should
 * be "the new column is missing" and not "the storefront has no tracks".
 *
 * So: request the optional columns, and if Postgres rejects them, retry without.
 * Only for genuinely optional columns — never use this to paper over a required
 * one, where silently returning rows with a missing field would be worse than
 * failing loudly.
 */

/** Postgres/PostgREST signature for an unknown column. */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: unknown; code?: unknown };
  // 42703 = undefined_column. PostgREST forwards it, but not always with the
  // code intact, so the message is checked too.
  if (e.code === '42703') return true;
  return typeof e.message === 'string' && /column .* does not exist/i.test(e.message);
}

/**
 * Run a query with optional columns, retrying without them if the schema is
 * behind.
 *
 * `run` receives the column list to use, so the caller keeps full control of
 * the rest of the query.
 */
export async function selectWithOptionalColumns<T>(
  base: string[],
  optional: string[],
  run: (columns: string) => Promise<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown; usedOptional: boolean }> {
  const first = await run([...base, ...optional].join(', '));
  if (!first.error) return { ...first, usedOptional: true };
  if (!isMissingColumnError(first.error)) return { ...first, usedOptional: true };

  const retry = await run(base.join(', '));
  return { ...retry, usedOptional: false };
}
