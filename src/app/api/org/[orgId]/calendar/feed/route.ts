/**
 * The signed-in member's own release-calendar link (LABEL-34; the feed is
 * …/calendar.ics, authenticated by the token this route hands out).
 *
 *  GET     where the member's link stands: `{ active, path? }`.
 *  POST    issue a link, or rotate it: every earlier URL stops working.
 *  DELETE  revoke it: the feed is off until a new one is issued.
 *
 * The token is DERIVED (feed-token.ts), not stored: its revocation state is
 * the member's own `calendar_feed.issued|revoked` audit events, so issuing
 * and revoking are audited by construction and need no table. `catalog.read`
 * is enough: the feed shows only the titles and dates of releases that
 * member could already list. An external project member is not a member of
 * the org and reaches none of this.
 *
 * Rotation is rate-limited; the token goes to the caller only, never into an
 * event payload or a log line.
 */
import { NextRequest, NextResponse } from 'next/server';
import { memberAccessFor, requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { feedPath, feedSecret, signFeedToken } from '@/lib/labelos/feed-token';
import { readFeedState } from '@/lib/labelos/feed-store';
import { rateLimitDurable } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.calendar-feed.manage');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

/** The link as it stands now, from the live state and membership. */
async function currentLink(orgId: string, userId: string) {
  const member = await memberAccessFor(orgId, userId);
  if (!member.ok) throw new Error('membership vanished');
  const state = await readFeedState(member.admin, orgId, userId);
  if (!state.active) return { active: false as const };
  const token = signFeedToken(feedSecret(), { orgId, userId, joinedAt: member.joinedAt, version: state.version });
  return { active: true as const, path: feedPath(orgId, token) };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Release calendar needs Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  try {
    return json(200, await currentLink(access.orgId, access.userId));
  } catch (err) {
    log.error('feed state failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the calendar link' });
  }
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Release calendar needs Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  if (!(await rateLimitDurable(`org-feed-rotate:${access.orgId}:${access.userId}`, 10, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many changes. Try again later.' });
  }
  try {
    const before = await readFeedState(access.admin, access.orgId, access.userId);
    // Audit class: if this event cannot be written the link is NOT changed.
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'calendar_feed.issued', { type: 'member', id: access.userId }, { rotated: before.version > 0 });
    return json(200, await currentLink(access.orgId, access.userId));
  } catch (err) {
    log.error('feed issue failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not issue the calendar link' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Release calendar needs Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  try {
    const before = await readFeedState(access.admin, access.orgId, access.userId);
    // Nothing to revoke: idempotent, and no event for a no-op.
    if (before.active) {
      await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'calendar_feed.revoked', { type: 'member', id: access.userId }, {});
    }
    return json(200, { active: false });
  } catch (err) {
    log.error('feed revoke failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not revoke the calendar link' });
  }
}
