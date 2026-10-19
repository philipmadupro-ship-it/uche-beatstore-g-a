/**
 * Who is told "N restricted" (doc 21 §5 #9, LABEL-52). Several screens say how
 * many songs, updates or requests a member cannot open, so the page can say
 * "restricted" instead of looking empty. That number is itself information:
 * to a roster artist or to staff limited to some artists it reveals how much
 * exists outside what they were given. So the count is shown to whole-org staff
 * only, and everyone else gets 0 — the screens already read 0 as "say nothing".
 *
 *  - role `artist`: never (they see their own material and no more);
 *  - staff with an artist scope (`artistScope !== null`): never;
 *  - owner, admin and members with no scope: yes.
 *
 * Applied where each store returns its count (feeds, Needs attention, legal
 * queue, A&R inbox, artist / project / song workspace, direction references,
 * overview), never in a component, so the number is not in the response at all.
 * The JSON of a hidden count must not differ by even a digit from "nothing
 * restricted" — which is why this returns the number 0 rather than omitting it.
 */
export type CountViewer = { role: string; artistScope: ReadonlySet<string> | readonly string[] | null | undefined };

/** True when this member may be told how much is restricted from them. */
export function mayShowRestrictedCounts(viewer: CountViewer): boolean {
  return viewer.role !== 'artist' && (viewer.artistScope === null || viewer.artistScope === undefined);
}

/** The count to send: the real one for whole-org staff, 0 for everyone else. */
export function restrictedCountFor(count: number, viewer: CountViewer): number {
  return mayShowRestrictedCounts(viewer) ? count : 0;
}
