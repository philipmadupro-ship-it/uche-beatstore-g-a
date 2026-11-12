/**
 * Put the Library's selected tracks into a playlist or a project — a new one or
 * an existing one.
 *
 * Selecting tracks only offered Edit, Tags, Create pack (priced + listed in the
 * store) and Delete, so turning a handful of picks into a plain playlist or
 * project meant opening an empty one and adding each track by hand. This is the
 * one sequence both buttons run, kept out of the component so it can be tested
 * with a fake `fetch` (CLAUDE.md: logic inside the component gets reverted).
 *
 * The routes already do the hard parts: they check the caller owns the parent
 * AND every track, skip tracks already in it, and append after the last position.
 */

export type CollectionKind = 'playlist' | 'project';

export interface CollectTarget {
  kind: CollectionKind;
  /** Add to this existing collection. Null = create a new one. */
  existingId: string | null;
  /** Name for a new collection; ignored for an existing one. Blank = the server names it. */
  name: string;
}

export interface CollectResult {
  kind: CollectionKind;
  id: string;
  created: boolean;
  /** Tracks newly added (already-present ones are skipped by the route). */
  added: number;
  skipped: number;
}

const BASE: Record<CollectionKind, string> = {
  playlist: '/api/playlists',
  project: '/api/projects',
};

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error ? body.error : `${fallback} (HTTP ${res.status})`;
}

export async function addTracksToCollection(
  target: CollectTarget,
  trackIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<CollectResult> {
  const ids = [...new Set(trackIds)];
  if (ids.length === 0) throw new Error('Select at least one track.');
  const label = target.kind === 'playlist' ? 'playlist' : 'project';

  let id = target.existingId;
  const created = id == null;
  if (id == null) {
    const res = await fetchImpl(BASE[target.kind], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: target.name.trim() }),
    });
    if (!res.ok) throw new Error(await errorOf(res, `Could not create the ${label}`));
    const data = await res.json().catch(() => null) as Record<string, { id?: unknown } | undefined> | null;
    const made = data?.[target.kind]?.id;
    if (typeof made !== 'string' || !made) throw new Error(`The ${label} was created without an id.`);
    id = made;
  }

  const add = await fetchImpl(`${BASE[target.kind]}/${encodeURIComponent(id)}/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track_ids: ids }),
  });
  if (!add.ok) {
    // A brand-new empty one is left behind on purpose: deleting from here could
    // remove something the producer already started using in another tab, and
    // the toast names it so it can be found.
    throw new Error(await errorOf(add, `Could not add tracks to the ${label}`));
  }
  const body = await add.json().catch(() => null) as { added?: unknown; skipped?: unknown } | null;
  const added = typeof body?.added === 'number' ? body.added : ids.length;
  const skipped = typeof body?.skipped === 'number' ? body.skipped : Math.max(0, ids.length - added);
  return { kind: target.kind, id, created, added, skipped };
}

/** Where to open the collection afterwards. */
export function collectionHref(kind: CollectionKind, id: string): string {
  return kind === 'playlist' ? `/playlists/${id}` : `/projects/${id}`;
}

/** The toast line for a finished add — says what actually happened, skips included. */
export function collectSummary(r: CollectResult, name: string): { title: string; description: string } {
  const noun = r.kind === 'playlist' ? 'playlist' : 'project';
  const n = (x: number) => `${x} track${x === 1 ? '' : 's'}`;
  const title = r.created ? `New ${noun} created` : `Added to ${noun}`;
  const parts = [`${n(r.added)} ${r.created ? 'in' : 'added to'} ${name || `your ${noun}`}`];
  if (r.skipped > 0) parts.push(`${r.skipped} already there or not yours, skipped`);
  return { title, description: parts.join(' · ') };
}
