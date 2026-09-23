/**
 * Chunked PostgREST `.in()` queries.
 *
 * PostgREST serialises `.in(col, values)` into the request URL as
 * `col=in.(v1,v2,…)`. The list is not paginated and not batched, so the URL
 * grows linearly with the id count — and past roughly 16–24KB the server
 * rejects the whole request with a bare `Bad Request` that surfaces as a 500.
 *
 * This is not hypothetical. `/api/tracks/store-summary` passed ~650 track ids
 * and produced a ~24KB URL; the resulting 500 took the entire store editor
 * down, which is why a full catalogue could sit with zero tracks listed — the
 * only UI for listing them could not open. Several CRM endpoints pass one id
 * per contact and sit on the same cliff as a contact list grows.
 *
 * Where a foreign key exists, an inner join is better still (constant URL,
 * one round trip) — that is what store-summary now uses. This helper is for
 * the cases with no usable relation to join through, such as matching
 * `buyer_favorites` by a list of email addresses.
 *
 * 200 ids/batch keeps each URL near 8KB of id payload for UUIDs — comfortably
 * inside the limit with room for the rest of the query string.
 */

export const IN_CHUNK_SIZE = 200;

export function chunkIds<T>(ids: readonly T[], size: number = IN_CHUNK_SIZE): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Run `query` once per batch of ids and concatenate the rows.
 *
 * Batches run sequentially: these are background/aggregate reads, and firing
 * dozens of parallel requests at PostgREST to avoid a URL limit would just
 * trade one ceiling for another. Returns [] for an empty id list without
 * issuing a request. Throws on the first batch error, matching the callers'
 * existing `if (error) throw` handling.
 */
export async function selectInChunks<T>(
  ids: readonly string[],
  query: (batch: string[]) => PromiseLike<QueryResult<T>>,
  size: number = IN_CHUNK_SIZE,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const rows: T[] = [];
  for (const batch of chunkIds(ids, size)) {
    const { data, error } = await query(batch);
    if (error) throw new Error(error.message);
    if (data) rows.push(...data);
  }
  return rows;
}
