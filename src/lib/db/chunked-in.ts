/**
 * `.in()` filters that survive a real catalogue.
 *
 * PostgREST takes its filters in the query string, so `.in('id', ids)` puts
 * every id into the URL. At a few hundred UUIDs that request is tens of
 * kilobytes and is rejected outright with a bare "Bad Request" — no hint about
 * length, nothing in the message to connect it to the id list.
 *
 * The failure mode is what makes this worth a shared helper: routes catch the
 * error and degrade to an empty result, so the symptom is a page that renders
 * as though the account were empty. It cost us the links page (22 shares
 * invisible) and the store-editor's "needs attention" panel before anyone
 * read it as a bug rather than as "nothing here yet".
 *
 * Three copies of the same loop already existed by the time it bit twice, so
 * it lives here now.
 */

/** Ids per request. 100 keeps each URL a few kilobytes. */
export const ID_CHUNK = 100;

export function chunkIds<T>(items: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface ChunkResult<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Run one query per chunk and merge the rows.
 *
 * The chunks fan out in parallel, so splitting costs one round trip rather
 * than one per chunk. Errors are rethrown rather than swallowed: a partial
 * list that looks complete is worse than a visible failure, because the
 * producer reads a missing row as deleted.
 */
export async function selectIn<T>(
  build: (ids: string[]) => PromiseLike<ChunkResult<T>>,
  ids: readonly string[],
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(chunkIds(ids).map((slice) => build(slice)));
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  return results.flatMap((result) => result.data ?? []);
}
