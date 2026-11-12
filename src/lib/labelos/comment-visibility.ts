/**
 * The portal, share-page and producer comment reads all exclude `internal`
 * comments (LABEL-22). `visibility` exists only from migration 150, so each
 * read runs WITH the filter first and, if the column is missing (a database
 * before 150), once more without it — there is no internal comment to hide
 * on such a database, since nothing could have written one.
 *
 * The filter is `visibility = 'artist'`, an allowlist: a value this code
 * does not know is hidden, not shown.
 */
import { isMissingSchema } from '@/lib/artists/workspace-load';

export const PUBLIC_COMMENT_VISIBILITY = 'artist';

export async function readWithoutInternal<R extends { error: unknown }>(read: (withVisibilityFilter: boolean) => PromiseLike<R>): Promise<R> {
  const res = await read(true);
  return res.error && isMissingSchema(res.error) ? read(false) : res;
}
