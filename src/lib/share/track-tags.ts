import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';

const log = createLogger('share.track-tags');

export interface ShareTrackTag {
  tag: string;
  category: string | null;
}

/** Any Supabase-shaped client; typed loosely so a service client's deep generics never reach callers. */
interface TagReaderLike {
  from: (table: string) => unknown;
}

interface TagQuery {
  select: (columns: string) => {
    in: (column: string, values: string[]) => PromiseLike<{ data: unknown; error?: unknown }>;
  };
}

/** Largest tag list one public track carries; a share row shows two chips. */
const MAX_TAGS_PER_TRACK = 12;

/**
 * Tags for the tracks of a share, keyed by track id, for the share page's
 * search and genre / mood filters.
 *
 * Read in its own query and never allowed to fail the share: a missing table
 * or a transient error means the page simply has no tag filters, not a 500 on
 * the link the producer just sent. Only `tag` and `category` leave the server.
 */
export async function loadShareTrackTags(
  admin: TagReaderLike,
  trackIds: string[],
): Promise<Map<string, ShareTrackTag[]>> {
  const out = new Map<string, ShareTrackTag[]>();
  if (trackIds.length === 0) return out;
  try {
    const { data, error } = await (admin.from('track_tags') as TagQuery).select('track_id, tag, category').in('track_id', trackIds);
    if (error || !Array.isArray(data)) return out;
    for (const row of data as { track_id?: unknown; tag?: unknown; category?: unknown }[]) {
      if (typeof row.track_id !== 'string' || typeof row.tag !== 'string' || !row.tag.trim()) continue;
      const list = out.get(row.track_id) ?? [];
      if (list.length >= MAX_TAGS_PER_TRACK) continue;
      list.push({ tag: row.tag, category: typeof row.category === 'string' ? row.category : null });
      out.set(row.track_id, list);
    }
  } catch (err) {
    log.warn('share tag read failed', { error: errorMessage(err) });
  }
  return out;
}

/** Attach `track_tags` (the library API's own name for them) to each public track; a track with none gets an empty list. */
export function withShareTags<T extends { id: string }>(
  tracks: T[],
  tags: Map<string, ShareTrackTag[]>,
): (T & { track_tags: ShareTrackTag[] })[] {
  return tracks.map((t) => ({ ...t, track_tags: tags.get(t.id) ?? [] }));
}
