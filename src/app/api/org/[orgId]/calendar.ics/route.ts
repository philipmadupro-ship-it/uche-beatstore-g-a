/**
 * GET /api/org/[orgId]/calendar.ics?token=… — the org's release dates as an
 * iCalendar feed (LABEL-34). A calendar app cannot send cookies, so the
 * signed per-user token in the URL is the ONLY credential (lib/labelos/
 * feed-token.ts) — which is why this route is deliberately narrow:
 *
 *  - Every failure is the same `404 {error:"Not found"}`: a malformed token,
 *    a wrong or revoked one, a token for another org or person, a member who
 *    left, an org that is gone, a member without `catalog.read` — a caller
 *    learns nothing about which. (A database fault is 503, so apps retry.)
 *  - The token is checked for SHAPE before any lookup, then recomputed from
 *    the LIVE membership (joined_at) and feed state (revocation) and compared
 *    in constant time. Revoking or re-issuing, leaving the org, or losing
 *    catalog.read ends the feed on the next fetch.
 *  - Titles and dates only, of the releases that member's artist scope shows
 *    (the same narrowing as the releases list). No artist, no project, no link.
 *  - Rate-limited per address and per person. The token is never logged: no
 *    request URL goes to a log line, and nothing here echoes it.
 *  - No session is read, and signed-out calls reach this file by design: the
 *    proxy lets any signed-out /api request through to its route (apiGateFor
 *    'none'); LABEL_OS_ENABLED and the database check still apply to the path.
 *
 * Not audited per fetch (an hourly poll would flood the log); issuing and
 * revoking the link are (…/calendar/feed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { memberAccessFor } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { feedSecret, parseFeedToken, verifyFeedToken } from '@/lib/labelos/feed-token';
import { feedReleases, readFeedState } from '@/lib/labelos/feed-store';
import { buildIcs } from '@/lib/labelos/release-calendar';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.calendar-feed');

type Params = { params: Promise<{ orgId: string }> };

const PRIVATE = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Release calendar needs Supabase.' }, { status: 501, headers: PRIVATE });

  if (!(await rateLimitDurable(`org-feed-ip:${clientIp(req)}`, 600, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...PRIVATE, 'Retry-After': '600' } });
  }
  const token = parseFeedToken(req.nextUrl.searchParams.get('token'));
  if (!token) return notFound();
  if (!(await rateLimitDurable(`org-feed:${orgId}:${token.userId}`, 120, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...PRIVATE, 'Retry-After': '600' } });
  }

  try {
    const access = await memberAccessFor(orgId, token.userId);
    if (!access.ok && access.reason === 'error') return NextResponse.json({ error: 'Try again later' }, { status: 503, headers: PRIVATE });
    const secret = feedSecret();
    // Verify even for a stranger, against a placeholder, so the work done does not tell members from non-members.
    const state = access.ok ? await readFeedState(access.admin, access.orgId, access.userId) : { active: false, version: 0 };
    const valid = verifyFeedToken(
      secret,
      { orgId, userId: token.userId, joinedAt: access.ok ? access.joinedAt : '', version: state.version },
      token.mac,
    );
    if (!access.ok || !valid || !state.active || !access.capabilities.has('catalog.read')) return notFound();

    const releases = await feedReleases(access.admin, access);
    const org = await access.admin.from('organizations').select('name').eq('id', access.orgId).maybeSingle();
    const orgName = (org.data as { name?: string } | null)?.name ?? 'Label';
    const body = buildIcs({ name: `${orgName} releases`, orgId: access.orgId, releases });
    return new NextResponse(body, {
      headers: { ...PRIVATE, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="releases.ics"' },
    });
  } catch (err) {
    log.error('calendar feed failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Try again later' }, { status: 503, headers: PRIVATE });
  }
}
