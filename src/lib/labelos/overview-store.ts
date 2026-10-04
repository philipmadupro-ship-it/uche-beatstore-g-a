/**
 * The reads behind the org Overview (LABEL-18). One scoped query set for the
 * whole roster, then the pure `summarizeRoster`. Called by
 * `GET /api/org/[orgId]/overview` and the `/o/<slug>` server page after
 * requireOrgCapability(`catalog.read`) authorised the member.
 *
 * Scope is applied at the source, never after: the roster comes from
 * `scopedOrgQuery` (an artists-scoped member lists only their contacts) and
 * the projects from `orgProjectIdsInScope` (the walk the parity test holds
 * equal to requireObjectAccess and `artistProjects`). The D4 row rule is
 * `partitionSongs` over `orgTrackFacts`, the same pair the artist workspace
 * uses. Every read carries `org_id`; no producer row can enter.
 *
 * Ids go to PostgREST in chunks (a catalogue-sized `in (…)` list overruns
 * the request-line limit) and every read is paged with `range`: PostgREST
 * caps a response (`max-rows`, 1000 on Supabase) without an error, so a
 * single read of a big org's placements would silently undercount.
 */

import type { OrgAccessOk } from '@/lib/auth/org-access';
import { orgProjectIdsInScope, scopedOrgQuery } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { ORG_CONTACT_COLUMNS, toOrgContactView, type OrgContactRow } from './org-contacts';
import { isWorkspaceSong, partitionSongs, type OrgTrackFacts } from './org-workspace';
import { orgTrackFacts } from './org-workspace-store';
import { summarizeRoster, type OverviewRelease, type RosterSummary } from './overview';

export type OrgOverview = RosterSummary & {
  /** False before migration 144: the next-release column says so. */
  releasesReady: boolean;
};

const CHUNK = 200;
const PAGE = 1000;

/** A failed read, keeping PostgREST's own error so a caller can tell a missing table from a real failure. */
class ReadError extends Error {
  constructor(what: string, readonly raw: { message: string }) {
    super(`${what}: ${raw.message}`);
  }
}

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new ReadError(what, res.error);
  return (res.data ?? []) as T[];
}

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

type Read = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Every row of a read, one `range` page at a time, until a short page. The read must be ordered so pages do not overlap. */
async function pageAll<T>(read: (from: number, to: number) => Read, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = rows<T>(await read(from, from + PAGE - 1), what);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** One paged read per chunk of ids, concatenated. */
async function inChunks<T>(ids: readonly string[], read: (part: string[], from: number, to: number) => Read, what: string): Promise<T[]> {
  const parts = await Promise.all(chunks([...new Set(ids)]).map((part) => pageAll<T>((from, to) => read(part, from, to), what)));
  return parts.flat();
}

export async function loadOrgOverview(access: OrgAccessOk): Promise<OrgOverview> {
  const { admin, orgId } = access;

  const contactRows = await pageAll<OrgContactRow>(
    (from, to) => scopedOrgQuery(admin, 'contacts', access, ORG_CONTACT_COLUMNS).order('name', { ascending: true }).order('id').range(from, to),
    'contact read',
  );
  const artists = contactRows
    .map(toOrgContactView)
    .filter((c) => c.in_roster)
    .map((c) => ({ id: c.id, name: c.name, avatar_url: c.avatar_url }));
  const empty = (releasesReady = true): OrgOverview => ({ ...summarizeRoster({ artists, projectArtists: new Map(), placements: [], songs: [], visibleSongIds: new Set(), releases: [] }), releasesReady });
  if (artists.length === 0) return empty();

  // Projects: the member's (whole org, or the scope walk).
  const scoped = await orgProjectIdsInScope(admin, access);
  if (scoped !== null && scoped.length === 0) return empty();
  type ProjectRow = { id: string; inbox_for_contact_id: string | null };
  const projects = scoped === null
    ? await pageAll<ProjectRow>((from, to) => admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', orgId).order('id').range(from, to), 'project read')
    : await inChunks<ProjectRow>(scoped, (part, from, to) => admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', orgId).in('id', part).order('id').range(from, to), 'project read');
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return empty();

  const [links, placements] = await Promise.all([
    inChunks<{ project_id: string; contact_id: string }>(projectIds, (part, from, to) => admin.from('project_contacts').select('project_id, contact_id').in('project_id', part).order('project_id').order('contact_id').range(from, to), 'project link read'),
    inChunks<{ project_id: string; track_id: string }>(projectIds, (part, from, to) => admin.from('project_tracks').select('project_id, track_id').in('project_id', part).order('project_id').order('track_id').range(from, to), 'project track read'),
  ]);
  const projectArtists = new Map<string, string[]>(projects.map((p) => [p.id, p.inbox_for_contact_id ? [p.inbox_for_contact_id] : []]));
  for (const l of links) projectArtists.get(l.project_id)?.push(l.contact_id);

  // Songs, and which of them the member may see (D4).
  const tracks = await inChunks<{ id: string; type: string | null; song_stage: string | null }>(
    placements.map((p) => p.track_id),
    (part, from, to) => admin.from('tracks').select('id, type, song_stage').in('id', part).eq('org_id', orgId).order('id').range(from, to),
    'track read',
  );
  const candidates = tracks.filter(isWorkspaceSong);
  const facts = new Map<string, OrgTrackFacts>();
  for (const part of await Promise.all(chunks(candidates.map((t) => t.id)).map((ids) => orgTrackFacts(admin, orgId, ids)))) {
    for (const [id, f] of part) facts.set(id, f);
  }
  const { visible } = partitionSongs(candidates, facts, access.capabilities);

  const releases = await rosterReleases(access, artists.map((a) => a.id), scoped);

  return {
    ...summarizeRoster({
      artists,
      projectArtists,
      placements: placements.map((p) => ({ projectId: p.project_id, trackId: p.track_id })),
      songs: candidates.map((t) => ({ id: t.id, stage: t.song_stage })),
      visibleSongIds: new Set(visible.map((t) => t.id)),
      releases: releases.list,
    }),
    releasesReady: releases.ready,
  };
}

type ReleaseRow = { id: string; project_id: string; contact_id: string; title: string; type: string; state: string; target_date: string | null; created_at: string };

/** Draft releases of these artists the member can see (144's rule: by project). A missing table is "not ready", not an error. */
async function rosterReleases(access: OrgAccessOk, artistIds: readonly string[], scoped: string[] | null): Promise<{ ready: boolean; list: OverviewRelease[] }> {
  const { admin, orgId } = access;
  const allowed = scoped === null ? null : new Set(scoped);
  const list: OverviewRelease[] = [];
  for (const part of chunks([...new Set(artistIds)])) {
    let page: ReleaseRow[];
    try {
      page = await pageAll<ReleaseRow>(
        (from, to) => admin
          .from('releases')
          .select('id, project_id, contact_id, title, type, state, target_date, created_at')
          .eq('org_id', orgId)
          .eq('state', 'draft')
          .in('contact_id', part)
          .order('id')
          .range(from, to),
        'release read',
      );
    } catch (err) {
      if (err instanceof ReadError && isMissingSchema(err.raw)) return { ready: false, list: [] };
      throw err;
    }
    for (const r of page) {
      if (allowed !== null && !allowed.has(r.project_id)) continue;
      list.push({ id: r.id, contactId: r.contact_id, projectId: r.project_id, title: r.title, type: r.type, state: r.state, targetDate: r.target_date, createdAt: r.created_at });
    }
  }
  return { ready: true, list };
}
