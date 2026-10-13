/**
 * The reads behind the release calendar feed (LABEL-34): the person's feed
 * state (from their audit events, see feed-token.ts) and the releases their
 * membership lets them see. Service role, org filter on every query; the
 * ROUTE authorises (a signed feed token for the .ics, a session for the
 * management route). Throws on a database error so a caller fails closed.
 */
import { orgProjectIdsInScope, type OrgContext } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { FEED_EVENT_VERBS, feedState, type FeedState } from './feed-token';
import type { CalendarRelease } from './release-calendar';

/** One person's feed state in one org: oldest event first, so the last one decides. */
export async function readFeedState(admin: AdminClient, orgId: string, userId: string): Promise<FeedState> {
  const { data, error } = await admin
    .from('activity_events')
    .select('verb')
    .eq('org_id', orgId)
    .eq('actor_id', userId)
    .in('verb', [...FEED_EVENT_VERBS])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(5000);
  if (error) throw new Error(`feed state read: ${error.message}`);
  return feedState(((data ?? []) as { verb: string }[]).map((r) => r.verb));
}

const FEED_LIMIT = 2000;

/**
 * The org's releases the member can see (their projects, as the releases list
 * does); `buildIcs` keeps the ones with a date and drops cancelled ones. Titles and dates only: no other
 * column is selected.
 */
export async function feedReleases(admin: AdminClient, ctx: OrgContext): Promise<CalendarRelease[]> {
  const projectIds = await orgProjectIdsInScope(admin, ctx);
  if (projectIds !== null && projectIds.length === 0) return [];
  let query = admin
    .from('releases')
    .select('id, title, release_date, target_date, state, updated_at')
    .eq('org_id', ctx.orgId);
  if (projectIds !== null) query = query.in('project_id', projectIds);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(FEED_LIMIT);
  if (error) {
    // Releases (migration 144) not applied: an empty calendar, not an error a calendar app would retry forever.
    if (isMissingSchema(error)) return [];
    throw new Error(`feed releases read: ${error.message}`);
  }
  return ((data ?? []) as { id: string; title: string; release_date: string | null; target_date: string | null; state: string; updated_at: string }[]).map((r) => ({
    id: r.id,
    title: r.title,
    releaseDate: r.release_date,
    targetDate: r.target_date,
    state: r.state,
    updatedAt: r.updated_at,
  }));
}
