import { after, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/security/rate-limit';
import { projectShareOwnerId, type ProjectShareRef } from '@/lib/share/share-owner';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';
import { recordShareEvent, type EventClient } from './share-events';
import type { ShareEventKind } from './link-activity';

const log = createLogger('links.share-events');

type Resolved = { kind: string; row: { id?: string; user_id?: string | null } & ProjectShareRef };

/** Only a browser that holds a Supabase session can be the producer previewing. */
function hasSessionCookie(req: NextRequest): boolean {
  return req.cookies.getAll().some((c) => c.name.startsWith('sb-'));
}

async function viewerUserId(req: NextRequest): Promise<string | null> {
  if (!hasSessionCookie(req)) return null;
  try {
    const { data } = await (await createServerClient()).auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Record one share event for a RESOLVED share (SHARE-06), after the response.
 *
 * Best effort and never awaited by the route: the work runs in `after()`, every
 * failure is swallowed (including a missing table before migration 203), and a
 * purchase token or artist portal records nothing. The owner of a share_links
 * row is its `user_id`; a project share has none, so it is the owner of what it
 * points at. The producer's own preview (a signed-in owner) is skipped. Only
 * the row id is stored, never the token.
 */
export function recordShareEventFor(
  req: NextRequest,
  admin: EventClient,
  resolved: Resolved,
  kind: ShareEventKind,
  trackId?: string | null,
): void {
  if (resolved.kind !== 'share_link' && resolved.kind !== 'project_share') return;
  const source = resolved.kind === 'share_link' ? 'share_links' : 'project_shares';
  const ip = clientIp(req);
  const work = async () => {
    try {
      const shareId = resolved.row.id;
      if (!shareId) return;
      const ownerUserId =
        resolved.kind === 'share_link' ? resolved.row.user_id ?? null : await projectShareOwnerId(admin, resolved.row);
      await recordShareEvent(admin, { source, shareId, ownerUserId, kind, trackId, ip, viewerUserId: await viewerUserId(req) });
    } catch (err) {
      log.warn('share event failed', { error: errorMessage(err) });
    }
  };
  try {
    after(work);
  } catch {
    void work();
  }
}
