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
 *  - Rate-limited, in this order so a stranger can never spend a member's
 *    allowance: ids are validated and lower-cased first; a coarse per-
 *    (address, org) bucket, generous because Google/Apple/Outlook fetch from
 *    shared addresses, counts everything; the per-person bucket is spent only
 *    AFTER the token verified, so junk requests cannot 429 the real calendar app. The token is never logged: no
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
import { feedEventUid, feedSecret, parseFeedToken, verifyFeedToken } from '@/lib/labelos/feed-token';
import { feedReleases, readFeedState } from '@/lib/labelos/feed-store';
import { buildIcs } from '@/lib/labelos/release-calendar';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { isUUID } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.calendar-feed');

type Params = { params: Promise<{ orgId: string }> };

const PRIVATE = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId: rawOrg } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Release calendar needs Supabase.' }, { status: 501, headers: PRIVATE });

  // Shape first, before any limiter or lookup: no unbounded key cardinality, no case variants.
  const token = parseFeedToken(req.nextUrl.searchParams.get('token'));
  if (!isUUID(rawOrg) || !token) return notFound();
  const orgId = rawOrg.toLowerCase();

  if (!(await rateLimitDurable(`org-feed-ip:${clientIp(req)}:${orgId}`, 1200, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...PRIVATE, 'Retry-After': '600' } });
  }

  try {
    const access = await memberAccessFor(orgId, token.userId);
    if (!access.ok && access.reason === 'error') return NextResponse.json({ error: 'Try again later' }, { status: 503, headers: PRIVATE });
    const secret = feedSecret();
    // A non-member skips the feed-state read, so this is NOT constant-time with respect to membership:
    // a revoked member costs one more query. The token still has to verify, and ids are UUIDs, so blind
    // enumeration of members is infeasible; the MAC comparison itself is constant-time.
    const state = access.ok ? await readFeedState(access.admin, access.orgId, access.userId) : { active: false, version: 0 };
    const valid = verifyFeedToken(
      secret,
      { orgId, userId: token.userId, joinedAt: access.ok ? access.joinedAt : '', version: state.version },
      token.mac,
    );
    if (!access.ok || !valid || !state.active || !access.capabilities.has('catalog.read')) return notFound();

    // Only now, with a verified token, does the member's own allowance get spent.
    if (!(await rateLimitDurable(`org-feed:${orgId}:${token.userId}`, 120, 60 * 60 * 1000))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...PRIVATE, 'Retry-After': '600' } });
    }

    const releases = await feedReleases(access.admin, access);
    // Generic name and opaque UIDs: neither the org name nor any row id is in the file.
    const body = buildIcs({ name: 'Releases', uidFor: (id) => feedEventUid(secret, id), releases });
    return new NextResponse(body, {
      headers: { ...PRIVATE, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="releases.ics"' },
    });
  } catch (err) {
    log.error('calendar feed failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Try again later' }, { status: 503, headers: PRIVATE });
  }
}
