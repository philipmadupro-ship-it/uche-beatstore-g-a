/**
 * Reads that survive a real catalogue (LABEL-18, shared by the org stores).
 *
 * Ids go to PostgREST in chunks (a catalogue-sized `in (…)` list overruns the
 * request-line limit) and every read is paged with `range`: PostgREST caps a
 * response (`max-rows`, 1000 on Supabase) without an error, so a single read
 * of a big org's placements would silently undercount.
 */

export const CHUNK = 200;
const PAGE = 1000;

/** A failed read, keeping PostgREST's own error so a caller can tell a missing table from a real failure. */
export class ReadError extends Error {
  constructor(what: string, readonly raw: { message: string }) {
    super(`${what}: ${raw.message}`);
  }
}

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new ReadError(what, res.error);
  return (res.data ?? []) as T[];
}

export function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

type Read = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Every row of a read, one `range` page at a time, until a short page. The read must be ordered so pages do not overlap. */
export async function pageAll<T>(read: (from: number, to: number) => Read, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = rows<T>(await read(from, from + PAGE - 1), what);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** One paged read per chunk of ids, concatenated. */
export async function inChunks<T>(ids: readonly string[], read: (part: string[], from: number, to: number) => Read, what: string): Promise<T[]> {
  const parts = await Promise.all(chunks([...new Set(ids)]).map((part) => pageAll<T>((from, to) => read(part, from, to), what)));
  return parts.flat();
}

