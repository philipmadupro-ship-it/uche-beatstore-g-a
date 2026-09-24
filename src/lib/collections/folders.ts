/**
 * Folder maths shared by /projects and /playlists.
 *
 * Membership is many-to-many (a project can sit in several folders), and the
 * API replaces the whole set on PUT — so filing by drag must send the UNION of
 * what the item already had and the target, never just the target, or dropping
 * a project into "Client work" silently pulls it out of "2026".
 */
export const COLLECTION_DRAG_MIME = 'application/x-antigravity-collection';

export function withFolder(current: readonly string[] | null | undefined, folderId: string): string[] {
  const ids = current ?? [];
  return ids.includes(folderId) ? [...ids] : [...ids, folderId];
}

export function withoutFolder(current: readonly string[] | null | undefined, folderId: string): string[] {
  return (current ?? []).filter((id) => id !== folderId);
}

/** Items per folder, plus the unfiled count, in one pass. */
export function folderCounts(
  items: ReadonlyArray<{ folder_ids?: readonly string[] | null }>,
): { byFolder: Map<string, number>; unfiled: number } {
  const byFolder = new Map<string, number>();
  let unfiled = 0;
  for (const item of items) {
    const ids = item.folder_ids ?? [];
    if (ids.length === 0) unfiled += 1;
    for (const id of new Set(ids)) byFolder.set(id, (byFolder.get(id) ?? 0) + 1);
  }
  return { byFolder, unfiled };
}
