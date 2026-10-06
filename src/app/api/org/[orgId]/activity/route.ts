/**
 * GET /api/org/[orgId]/activity (LABEL-20) — the activity feeds (08 §B5):
 *
 *   (no key)        the org overview feed
 *   ?artist=<id>    one roster artist's feed (their events + their projects' files)
 *   ?project=<id>   one project's feed
 *   ?song=<id>      one song's history
 *   &since=<iso>    only events after (the overview's "since your last visit")
 *   &before=<cursor> page back from the previous response's `nextBefore`
 *   &limit=<n>      page size, 1–200 (default 100)
 *
 * Every feed needs `catalog.read`. A keyed feed is authorised on its object
 * with requireObjectAccess, which reads the row's org and the member's artist
 * scope: another org's, a producer's, an out-of-scope or a missing object is
 * 404. Which EVENTS the member then gets is lib/labelos/activity-feed's
 * `eventVisibleTo` — the TS twin of migration 147's policy: business-internal
 * events need business.read.internal, an artists-scoped member (and a roster
 * artist) gets only their artists' and projects' events, never another
 * artist's and never the organization-level ones — plus D4 (events about a
 * song whose row the member may not read are counted, not listed).
 *
 * The body is built field by field: ids, the verb, a few whitelisted payload
 * fields, names — never a payload, a token or an email.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess, requireOrgCapability, type OrgAccessResult } from '@/lib/auth/org-access';
import { OrgActivityQuerySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { loadActivityFeed, memberSeesSong, type FeedTarget } from '@/lib/labelos/activity-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.activity');
const NO_STORE = { 'Cache-Control': 'no-store' };

type Params = { params: Promise<{ orgId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  // An empty value (`?before=`) is an absent one; a repeated key keeps its last value, which is the one authorised below.
  const raw = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''));
  const query = OrgActivityQuerySchema.safeParse(raw);
  if (!query.success) return NextResponse.json({ error: query.error.issues[0]?.message ?? 'Invalid query' }, { status: 400 });
  const { artist, project, song, since, before, limit } = query.data;

  let access: OrgAccessResult;
  let target: FeedTarget;
  if (artist) {
    access = await requireObjectAccess({ table: 'contacts', id: artist, cap: 'catalog.read', orgId });
    target = { kind: 'artist', id: artist };
  } else if (project) {
    access = await requireObjectAccess({ table: 'projects', id: project, cap: 'catalog.read', orgId });
    target = { kind: 'project', id: project };
  } else if (song) {
    access = await requireObjectAccess({ table: 'tracks', id: song, cap: 'catalog.read', orgId });
    target = { kind: 'song', id: song };
  } else {
    access = await requireOrgCapability(orgId, 'catalog.read');
    target = { kind: 'org' };
  }
  if (!access.ok) return access.res;

  try {
    // D4: a song the member may not read has no history for them either — 404, as its page.
    if (target.kind === 'song' && !(await memberSeesSong(access, target.id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const feed = await loadActivityFeed(access, { target, since, before, limit });
    return NextResponse.json(feed, { headers: NO_STORE });
  } catch (err) {
    log.error('activity load failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the activity' }, { status: 500 });
  }
}
