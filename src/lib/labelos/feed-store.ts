/**
 * The reads behind the release calendar feed (LABEL-34): the person's feed
 * state (from their audit events, see feed-token.ts) and the releases their
 * membership lets them see. Service role, org filter on every query; the
 * ROUTE authorises (a signed feed token for the .ics, a session for the
 * management route). Throws on a database error so a caller fails closed.
 */
import { orgHasModule, orgProjectIdsInScope, type OrgAccessOk, type OrgContext } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { FEED_EVENT_VERBS, feedStateFromLatest, type FeedState } from './feed-token';
import type { CalendarContract, CalendarRelease } from './release-calendar';
import { mayReadContract } from './contracts/access';
import { ContractsNotReadyError, linksOf, listContractRows } from './contracts-store';
import { contractActor, readScopeFor } from './contracts-route';

/**
 * One person's feed state in one org. The version is an EXACT COUNT and the
 * decider is the single latest event: never a capped ascending read, because
 * PostgREST's max-rows would truncate to the OLDEST events and freeze both
 * `version` and `active` (a revoke would stop taking effect).
 */
export async function readFeedState(admin: AdminClient, orgId: string, userId: string): Promise<FeedState> {
  const base = () => admin.from('activity_events').select('verb', { count: 'exact', head: true }).eq('org_id', orgId).eq('actor_id', userId).in('verb', [...FEED_EVENT_VERBS]);
  const counted = await base();
  if (counted.error) throw new Error(`feed state read: ${counted.error.message}`);
  const count = counted.count ?? 0;
  if (count === 0) return feedStateFromLatest(0, null);
  const latest = await admin
    .from('activity_events')
    .select('verb')
    .eq('org_id', orgId)
    .eq('actor_id', userId)
    .in('verb', [...FEED_EVENT_VERBS])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (latest.error) throw new Error(`feed state read: ${latest.error.message}`);
  return feedStateFromLatest(count, ((latest.data ?? []) as { verb: string }[])[0]?.verb ?? null);
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

/**
 * Contracts whose term can end (LABEL-60): the ones THIS member may read
 * (`mayReadContract`: their artist scope, or a sent contract that names them),
 * in an org licensed for contracts. Only the title, the dates and the status
 * leave this function. Without migration 176 the calendar simply has no
 * contract events.
 */
export async function feedContracts(access: OrgAccessOk): Promise<CalendarContract[]> {
  if (!orgHasModule(access, 'contracts')) return [];
  try {
    const actor = await contractActor(access);
    const rows = await listContractRows(access.admin, access.orgId, readScopeFor(actor));
    const links = await linksOf(access.admin, access.orgId, rows.map((r) => r.id));
    return rows
      .filter((r) => (r.status === 'sent' || r.status === 'signed') && r.effective_date && r.term_months)
      .filter((r) => mayReadContract(actor, { status: r.status, artist_contact_id: r.artist_contact_id, partyIds: (links.get(r.id) ?? []).map((l) => l.party_id) }))
      .map((r) => ({ id: r.id, title: r.title, status: r.status, effectiveDate: r.effective_date, termMonths: r.term_months, updatedAt: r.updated_at }));
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return [];
    throw err;
  }
}
