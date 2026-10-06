/**
 * The reads behind the activity feeds (LABEL-20): the org overview digest, an
 * artist's Activity tab, and the project and song feeds. Called by
 * `GET /api/org/[orgId]/activity` and by the `/o/<slug>` server page after
 * `requireOrgCapability('catalog.read')` / `requireObjectAccess` authorised the
 * member for the feed's object.
 *
 * WHO SEES WHAT is `eventVisibleTo` (activity-feed.ts) on the member's CURRENT
 * scope, then D4 (`withholdHiddenSongs`): the service role bypasses RLS, so
 * the same rule migration 147 states for the policy is applied here, event by
 * event, and it is the filter that decides — the database filters below only
 * make the scan cheaper and can only ever drop rows that filter would drop.
 *
 * `scopedOrgQuery` is used for the contact names (an artists-scoped member
 * resolves only their own artists' names) but NOT for the events themselves:
 * for activity_events it narrows by `artist_id`, which would drop the
 * project-only events (project files) a scoped member does see.
 *
 * The scan is bounded: events are read newest first in pages, filtered, and
 * collected until one more than `limit` are kept or `SCAN_CAP` rows have been
 * read. Hitting the cap is never silent — `hasMore` and `nextBefore` say
 * where to continue (a (created_at, id) position, so a group of events
 * written in one transaction is never split by a page boundary). `asOf` is
 * taken BEFORE the events and trails the clock by a margin, so "seen through
 * asOf" cannot cover an event written while the page was loading, or one the
 * database stamped slightly earlier than it became visible.
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { orgProjectIdsInScope, scopedOrgQuery } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { memberIdentities, type IdentityAdmin } from './member-identity';
import { memberSeesTrackRow } from './org-workspace';
import { artistProjects, orgTrackFacts } from './org-workspace-store';
import {
  ACTIVITY_COLUMNS,
  eventVisibleTo,
  formatCursor,
  parseCursor,
  projectArtistsFor,
  toFeedEvent,
  withholdHiddenSongs,
  type ActivityRow,
  type FeedCursor,
  type FeedEvent,
  type FeedViewer,
} from './activity-feed';
import { readLastSeenOverview } from './last-seen';
import { sinceWindow, type DigestNames } from './digest';

export type FeedTarget =
  | { kind: 'org' }
  | { kind: 'artist'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'song'; id: string };

export type FeedRequest = {
  target: FeedTarget;
  /** Only events after this instant. */
  since?: string;
  /** The previous page's `nextBefore`: only events after that position in (created_at, id) order. */
  before?: string;
  limit: number;
};

export type ActivityFeed = {
  /** Newest first. */
  events: FeedEvent[];
  names: DigestNames;
  /** Project-only events are filed under these artists (the member's own scope only). */
  projectArtists: Record<string, string[]>;
  /** Events withheld because they are about songs the member may not read (D4): a number, never a title. */
  restricted: number;
  hasMore: boolean;
  /** Pass as `before` for the next page (`<created_at>_<id>`). */
  nextBefore: string | null;
  /** When this feed was read, less a margin: what "seen through" may claim. */
  asOf: string;
};

const PAGE = 300;
const SCAN_CAP = 3000;
const CHUNK = 100;
/**
 * `asOf` is the app server's clock, `created_at` is the database's transaction
 * start: a row can be stamped a little BEFORE the instant it becomes visible.
 * Marking the digest seen through `now` would skip such a row for good, so the
 * mark trails the read by this margin — at worst a few events show twice.
 */
const ASOF_MARGIN_MS = 10_000;
/** An artist's project-only events are narrowed in the database when they have at most this many projects. */
const ARTIST_PROJECT_FILTER_MAX = 150;

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const unique = <T>(list: readonly (T | null | undefined)[]): T[] => [...new Set(list.filter((v): v is T => v !== null && v !== undefined))];

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

/**
 * Can the member read this song's row (D4)? The song feed answers 404 for a
 * song they cannot, as the song page does.
 */
export async function memberSeesSong(access: OrgAccessOk, songId: string): Promise<boolean> {
  const facts = await orgTrackFacts(access.admin, access.orgId, [songId]);
  const f = facts.get(songId);
  return !!f && memberSeesTrackRow(access.capabilities, f);
}

export async function loadActivityFeed(access: OrgAccessOk, req: FeedRequest): Promise<ActivityFeed> {
  const asOf = new Date(Date.now() - ASOF_MARGIN_MS).toISOString();
  const { admin, orgId, capabilities } = access;
  const target = req.target;
  const targetId = target.kind === 'org' ? null : target.id.toLowerCase();

  const [scoped, ownProjects] = await Promise.all([
    orgProjectIdsInScope(admin, access),
    target.kind === 'artist' ? artistProjects(admin, orgId, target.id) : Promise.resolve(null),
  ]);
  const viewer: FeedViewer = {
    capabilities,
    artistScope: access.artistScope,
    projectsInScope: scoped === null ? null : new Set(scoped.map((id) => id.toLowerCase())),
  };
  const sees = capabilities.has('business.read.internal');

  // An artist's feed is their events plus the project-only events of their projects.
  let artistProjectIds: Set<string> | null = null;
  let artistFilter: string | null = null;
  if (target.kind === 'artist' && ownProjects) {
    artistProjectIds = new Set(ownProjects.map((p) => p.id.toLowerCase()));
    const ids = [...artistProjectIds];
    artistFilter = ids.length === 0
      ? `artist_id.eq.${targetId}`
      : ids.length <= ARTIST_PROJECT_FILTER_MAX
        ? `artist_id.eq.${targetId},and(artist_id.is.null,project_id.in.(${ids.join(',')}))`
        : `artist_id.eq.${targetId},and(artist_id.is.null,project_id.not.is.null)`;
  }

  const belongs = (e: FeedEvent): boolean => {
    switch (target.kind) {
      case 'artist':
        return e.artistId === targetId || (e.artistId === null && e.projectId !== null && !!artistProjectIds?.has(e.projectId));
      case 'project':
        return e.projectId === targetId;
      case 'song':
        return e.songId === targetId;
      default:
        return true;
    }
  };

  const page = async (cursor: FeedCursor | null): Promise<ActivityRow[]> => {
    let q = admin.from('activity_events').select(ACTIVITY_COLUMNS).eq('org_id', orgId);
    if (!sees) q = q.eq('visibility', 'artist');
    if (target.kind === 'project') q = q.eq('project_id', targetId as string);
    if (target.kind === 'song') q = q.eq('song_id', targetId as string);
    if (artistFilter) q = q.or(artistFilter);
    if (req.since) q = q.gt('created_at', req.since);
    // Keyset: strictly after the cursor in (created_at DESC, id DESC). A second `or` is ANDed with the first by PostgREST.
    if (cursor) q = cursor.id ? q.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`) : q.lt('created_at', cursor.at);
    return rows<ActivityRow>(await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE), 'activity read');
  };

  // D4, remembered across pages: song id → may the member read its row?
  const songSeen = new Map<string, boolean>();
  const classify = async (songIds: readonly string[]) => {
    const fresh = unique(songIds).filter((id) => !songSeen.has(id));
    for (const part of await Promise.all(chunks(fresh).map((ids) => orgTrackFacts(admin, orgId, ids)))) {
      for (const [id, f] of part) songSeen.set(id.toLowerCase(), memberSeesTrackRow(capabilities, f));
    }
    for (const id of fresh) if (!songSeen.has(id)) songSeen.set(id, false); // not an org track of this org: fail closed
  };

  const kept: FeedEvent[] = [];
  let restricted = 0;
  let scanned = 0;
  let exhausted = false;
  let cursor = parseCursor(req.before);
  let lastScanned: ActivityRow | null = null;
  while (kept.length <= req.limit && scanned < SCAN_CAP) {
    const batch = await page(cursor);
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    scanned += batch.length;
    lastScanned = batch[batch.length - 1];
    const visible = batch.map(toFeedEvent).filter((e) => eventVisibleTo(viewer, e) && belongs(e));
    await classify(visible.map((e) => e.songId).filter((id): id is string => id !== null));
    const { kept: ok, withheld } = withholdHiddenSongs(visible, new Set([...songSeen].filter(([, v]) => v).map(([id]) => id)));
    kept.push(...ok);
    restricted += withheld;
    if (batch.length < PAGE) {
      exhausted = true;
      break;
    }
    cursor = { at: lastScanned.created_at, id: lastScanned.id.toLowerCase() };
  }

  let events = kept;
  let hasMore = false;
  let nextBefore: string | null = null;
  if (kept.length > req.limit) {
    events = kept.slice(0, req.limit);
    hasMore = true;
    const last = events[events.length - 1];
    nextBefore = formatCursor({ created_at: last.at, id: last.id });
  } else if (!exhausted && lastScanned) {
    hasMore = true;
    nextBefore = formatCursor(lastScanned);
  }

  const { names, projectArtists } = await resolveNames(access, events, scoped, target.kind === 'org');
  return { events, names, projectArtists, restricted, hasMore, nextBefore, asOf };
}

/**
 * Names for what the events mention. Actors by name only — an artist-role
 * viewer is never shown an email. Artists come through `scopedOrgQuery`,
 * releases are kept only when their project is in scope, so nothing outside
 * the member's reach is named.
 */
async function resolveNames(
  access: OrgAccessOk,
  events: readonly FeedEvent[],
  scopedProjects: string[] | null,
  fileProjectOnly: boolean,
): Promise<{ names: DigestNames; projectArtists: Record<string, string[]> }> {
  const { admin, orgId } = access;
  const actors: Record<string, string> = {};
  const artists: Record<string, string> = {};
  const releases: Record<string, string> = {};

  const actorIds = unique(events.map((e) => e.actorId));
  const identities = await memberIdentities(admin as unknown as IdentityAdmin, orgId, actorIds, { withEmail: false });
  for (const [id, who] of identities) if (who.name) actors[id] = who.name;

  // Project-only events are filed under their project's artists (overview).
  const projectArtists: Record<string, string[]> = {};
  if (fileProjectOnly) {
    const projectIds = unique(events.filter((e) => e.artistId === null).map((e) => e.projectId));
    if (projectIds.length > 0) {
      const projects: { id: string; inbox_for_contact_id: string | null }[] = [];
      const links: { project_id: string; contact_id: string }[] = [];
      await Promise.all(chunks(projectIds).map(async (part) => {
        const [p, l] = await Promise.all([
          admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', orgId).in('id', part),
          admin.from('project_contacts').select('project_id, contact_id').in('project_id', part),
        ]);
        projects.push(...rows<{ id: string; inbox_for_contact_id: string | null }>(p, 'project read'));
        links.push(...rows<{ project_id: string; contact_id: string }>(l, 'project link read'));
      }));
      for (const [id, list] of projectArtistsFor(projects, links, access.artistScope)) projectArtists[id] = list;
    }
  }

  const artistIds = unique([...events.map((e) => e.artistId), ...Object.values(projectArtists).flat()]);
  const contactReads = chunks(artistIds).map(async (part) => rows<{ id: string; name: string }>(await scopedOrgQuery(admin, 'contacts', access, 'id, name').in('id', part), 'contact read'));
  for (const list of await Promise.all(contactReads)) for (const c of list) artists[c.id.toLowerCase()] = c.name;

  const releaseIds = unique(events.map((e) => e.releaseId));
  const allowed = scopedProjects === null ? null : new Set(scopedProjects.map((id) => id.toLowerCase()));
  const releaseReads = await Promise.all(chunks(releaseIds).map((part) => admin.from('releases').select('id, title, project_id').eq('org_id', orgId).in('id', part)));
  for (const res of releaseReads) {
    if (res.error) {
      if (isMissingSchema(res.error)) break; // before migration 144 there are no releases to name
      throw new Error(`release read: ${res.error.message}`);
    }
    for (const r of (res.data ?? []) as { id: string; title: string; project_id: string }[]) {
      if (allowed === null || allowed.has(r.project_id.toLowerCase())) releases[r.id.toLowerCase()] = r.title;
    }
  }

  return { names: { actors, artists, releases }, projectArtists };
}

/** The Overview's digest: events since the member's last visit (at most 30 days back), and what it was measured from. */
export async function loadOverviewDigest(
  access: OrgAccessOk,
  now = new Date(),
): Promise<{ feed: ActivityFeed; since: string; lastSeenAt: string | null }> {
  const lastSeenAt = await readLastSeenOverview(access.admin, access.userId);
  const since = sinceWindow(lastSeenAt, now);
  const feed = await loadActivityFeed(access, { target: { kind: 'org' }, since, limit: 200 });
  return { feed, since, lastSeenAt };
}
