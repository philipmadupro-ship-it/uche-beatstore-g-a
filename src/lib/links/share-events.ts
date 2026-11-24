import { hashClientIp } from '@/lib/security/ip-hash';
import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';
import type { ShareEventKind } from './link-activity';

const log = createLogger('links.share-events');

/** Opens from one visitor inside this window count once: a refresh is not an open. */
export const OPEN_DEDUPE_MS = 30 * 60 * 1000;

export interface ShareEventEntry {
  source: 'share_links' | 'project_shares';
  /** The share ROW id. Never the token: it is a bearer credential. */
  shareId: string;
  ownerUserId: string | null;
  kind: ShareEventKind;
  trackId?: string | null;
  ip: string;
  /** The signed-in caller, if any. The producer previewing their own link records nothing. */
  viewerUserId?: string | null;
}

type Result = { data?: unknown; error: { message: string } | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;
/** The slice of the service client this needs (keeps the helper testable). */
export type EventClient = {
  from: (table: string) => Query;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Best effort: recording must never block or fail the response, so every
 * failure (including a missing table before 203) is logged and swallowed. The
 * log carries row ids only, never a token.
 */
export async function recordShareEvent(
  admin: EventClient,
  entry: ShareEventEntry,
  now: number = Date.now(),
): Promise<void> {
  try {
    if (!entry.ownerUserId || !UUID_RE.test(entry.shareId)) return;
    if (entry.viewerUserId && entry.viewerUserId === entry.ownerUserId) return;
    const ipHash = hashClientIp(entry.ip);

    if (entry.kind === 'open') {
      // Read through the (owner, share, created_at) index before writing.
      const since = new Date(now - OPEN_DEDUPE_MS).toISOString();
      const { data, error } = (await admin
        .from('share_events')
        .select('id')
        .eq('owner_user_id', entry.ownerUserId)
        .eq('share_id', entry.shareId)
        .eq('kind', 'open')
        .eq('ip_hash', ipHash)
        .gte('created_at', since)
        .limit(1)) as Result;
      if (error) {
        log.warn('share event dedupe read failed', { error: error.message });
        return;
      }
      if (Array.isArray(data) && data.length > 0) return;
    }

    const { error } = (await admin.from('share_events').insert({
      share_source: entry.source,
      share_id: entry.shareId,
      owner_user_id: entry.ownerUserId,
      kind: entry.kind,
      track_id: entry.trackId && UUID_RE.test(entry.trackId) ? entry.trackId : null,
      ip_hash: ipHash,
    })) as Result;
    if (error) log.warn('share event write failed', { error: error.message });
  } catch (err) {
    log.warn('share event write threw', { error: errorMessage(err) });
  }
}
