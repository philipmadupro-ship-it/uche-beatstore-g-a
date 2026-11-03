/**
 * The reads behind `GET /api/org/[orgId]/creative` (LABEL-68): ONE server-side pass that gathers, for the member who asks,
 * what the earlier tasks stored about the creative side — direction (152), references (152), reviews (149), song stages
 * (140 / LABEL-24) and releases with the creative approval (144 / 157) — and hands it to `creative-workspace.ts` to be
 * shaped. It owns no table and writes nothing.
 *
 * Every rule is the source screen's, applied again here and never loosened:
 *  - the member's artist scope narrows the roster, the projects and the releases (`orgProjectIdsInScope`,
 *    `scopedOrgQuery`); a scoped member never sees an artist outside it;
 *  - songs go through D4's row rule (`partitionSongs`), and the ones it hides are only COUNTED, for a viewer allowed to
 *    see such counts (`restrictedCountFor`);
 *  - references go through `partitionReferences` + `resolvePointers`: an internal reference never reaches a member whose
 *    role is `artist`, and a track or file the member cannot open is not counted as theirs;
 *  - reviews are read only with `review.comment` (migration 149's policy asks the same);
 *  - the creative status of a release is `creativeGateState`, the function the release page's readiness uses.
 *
 * Service role with an org filter on every query; authorisation is the route's.
 */
import { orgProjectIdsInScope, scopedOrgQuery, type OrgAccessOk } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { APPROVAL_COLUMNS, currentDecision, type ApprovalRow } from './approvals';
import { currentSnapshot, isMissingApprovalsSchema, readReleaseFacts } from './approvals-store';
import { buildArtistCards, creativeOpen, sortCreativeReleases, tallyStages, workspaceTotals, REVIEW_STAGES, type ArtistCardInput, type CreativeReleaseInput, type CreativeWorkspace } from './creative-workspace';
import { partitionReferences, type ReferenceRow } from './direction';
import { REFERENCE_COLUMNS, resolvePointers } from './direction-store';
import { isWorkspaceSong, partitionSongs } from './org-workspace';
import { orgTrackFacts, projectArtists } from './org-workspace-store';
import { chunks, inChunks, pageAll } from './paged-read';
import { creativeGateState } from './release-readiness';
import { readCreativeGate } from './creative-store';
import { RELEASE_COLUMNS, type ReleaseRow } from './releases';
import { restrictedCountFor } from './restricted-counts';
import { isRosterContact, NO_WORKSPACE } from './roster';
import { reviewsForSongs } from './song-review-store';

/** Draft releases whose creative status is worked out (each costs a few reads). The rest are counted, not dropped silently. */
export const CREATIVE_RELEASE_LIMIT = 50;
const CONCURRENCY = 5;

async function inGroups<T, R>(list: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

type ContactRow = { id: string; name: string; avatar_url: string | null; category: string | null; secondary_category: string | null };

export async function loadCreativeWorkspace(access: OrgAccessOk): Promise<CreativeWorkspace> {
  const { admin, orgId: org } = access;
  const gate = await readCreativeGate(admin, org);
  const canApprove = access.capabilities.has('creative.approve');
  const base = { gate, canApprove, canWrite: access.capabilities.has('catalog.write') };

  // 1. The roster artists inside the member's scope.
  const contacts = (
    await pageAll<ContactRow>(
      (from, to) => scopedOrgQuery(admin, 'contacts', access, 'id, name, avatar_url, category, secondary_category').order('id').range(from, to),
      'roster read',
    )
  ).filter((c) => isRosterContact(c, NO_WORKSPACE));
  const contactIds = contacts.map((c) => c.id);
  if (contactIds.length === 0) {
    return { ...base, schemaReady: true, artists: [], releases: [], restricted: 0, totals: workspaceTotals([], []) };
  }

  // 2. Direction + references (migration 152; before it the workspace still shows songs and releases).
  let schemaReady = true;
  const directions = new Map<string, unknown>();
  const referenceCounts = new Map<string, number>();
  try {
    const dirs = await inChunks<{ contact_id: string; direction: unknown }>(
      contactIds,
      (part, from, to) => admin.from('artist_direction').select('contact_id, direction').eq('org_id', org).in('contact_id', part).order('contact_id').range(from, to),
      'direction read',
    );
    for (const d of dirs) directions.set(d.contact_id, d.direction);
    const refs = await inChunks<ReferenceRow & { contact_id: string }>(
      contactIds,
      (part, from, to) => admin.from('artist_references').select(`contact_id, ${REFERENCE_COLUMNS}`).eq('org_id', org).in('contact_id', part).order('contact_id').order('id').range(from, to),
      'reference read',
    );
    const resolve = await resolvePointers(admin, access, refs);
    const byContact = new Map<string, ReferenceRow[]>();
    for (const r of refs) byContact.set(r.contact_id, [...(byContact.get(r.contact_id) ?? []), r]);
    for (const [id, list] of byContact) referenceCounts.set(id, partitionReferences(list, access.role, resolve).visible.length);
  } catch (err) {
    if (!(err instanceof Error && isMissingSchema({ message: err.message }))) throw err;
    schemaReady = false;
  }

  // 3. Songs: the member's projects → their songs → D4, then per artist by stage.
  const scoped = await orgProjectIdsInScope(admin, access);
  const projects =
    scoped === null
      ? await pageAll<{ id: string; inbox_for_contact_id: string | null }>((from, to) => admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', org).order('id').range(from, to), 'project read')
      : await inChunks<{ id: string; inbox_for_contact_id: string | null }>(scoped, (part, from, to) => admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', org).in('id', part).order('id').range(from, to), 'project read');
  const artistsOf = new Map<string, string[]>();
  for (const part of await Promise.all(chunks(projects).map((p) => projectArtists(admin, p)))) for (const [k, v] of part) artistsOf.set(k, v);
  const placements = await inChunks<{ project_id: string; track_id: string }>(
    projects.map((p) => p.id),
    (part, from, to) => admin.from('project_tracks').select('project_id, track_id').in('project_id', part).order('project_id').order('track_id').range(from, to),
    'placement read',
  );
  const trackIds = [...new Set(placements.map((p) => p.track_id))];
  const tracks = (
    await inChunks<{ id: string; type: string | null; song_stage: string | null }>(
      trackIds,
      (part, from, to) => admin.from('tracks').select('id, type, song_stage').eq('org_id', org).in('id', part).order('id').range(from, to),
      'song read',
    )
  ).filter(isWorkspaceSong);
  const facts = await orgTrackFacts(admin, org, tracks.map((t) => t.id));
  const { visible, hidden } = partitionSongs(tracks, facts, access.capabilities);
  const restricted = restrictedCountFor(hidden, access);

  // Reviews, only for the songs waiting on them and only for a member who may read them.
  const mayReadReviews = access.capabilities.has('review.comment');
  const inReview = visible.filter((t) => (REVIEW_STAGES as readonly (string | null)[]).includes(t.song_stage));
  const reviewed = new Set<string>();
  if (mayReadReviews && inReview.length > 0) {
    for (const part of chunks(inReview.map((t) => t.id))) for (const [id, list] of await reviewsForSongs(admin, org, part)) if (list.length > 0) reviewed.add(id);
  }

  const projectsOfTrack = new Map<string, string[]>();
  for (const p of placements) projectsOfTrack.set(p.track_id, [...(projectsOfTrack.get(p.track_id) ?? []), p.project_id]);
  const stagesByArtist = new Map<string, { stage: string | null; id: string }[]>();
  for (const t of visible) {
    const seen = new Set<string>();
    for (const pid of projectsOfTrack.get(t.id) ?? []) {
      for (const artist of artistsOf.get(pid) ?? []) {
        if (seen.has(artist)) continue;
        seen.add(artist);
        stagesByArtist.set(artist, [...(stagesByArtist.get(artist) ?? []), { stage: t.song_stage, id: t.id }]);
      }
    }
  }

  // 4. Draft releases in the member's scope, newest first; the creative status of each while the gate is on.
  const releaseRows =
    scoped === null
      ? await pageAll<ReleaseRow>((from, to) => admin.from('releases').select(RELEASE_COLUMNS).eq('org_id', org).eq('state', 'draft').order('created_at', { ascending: false }).order('id').range(from, to), 'release read').catch((err: unknown) => {
          if (err instanceof Error && isMissingSchema({ message: err.message })) return [] as ReleaseRow[];
          throw err;
        })
      : await inChunks<ReleaseRow>(scoped, (part, from, to) => admin.from('releases').select(RELEASE_COLUMNS).eq('org_id', org).eq('state', 'draft').in('project_id', part).order('id').range(from, to), 'release read').catch((err: unknown) => {
          if (err instanceof Error && isMissingSchema({ message: err.message })) return [] as ReleaseRow[];
          throw err;
        });
  const drafts = [...releaseRows].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(0, CREATIVE_RELEASE_LIMIT);
  const nameOf = new Map(contacts.map((c) => [c.id, c.name]));

  const releases: CreativeReleaseInput[] = await inGroups(drafts, CONCURRENCY, async (row): Promise<CreativeReleaseInput> => {
    const out: CreativeReleaseInput = {
      id: row.id,
      title: row.title,
      state: row.state,
      artistId: row.contact_id,
      artistName: nameOf.get(row.contact_id) ?? null,
      targetDate: row.target_date,
      releaseDate: row.release_date,
      createdAt: row.created_at,
      creative: null,
    };
    if (!gate) return out;
    try {
      const rel = await readReleaseFacts(admin, org, row.id);
      if (!rel) return out;
      const approvals = await admin.from('approvals').select(APPROVAL_COLUMNS).eq('org_id', org).eq('release_id', row.id).eq('gate', 'creative').order('created_at', { ascending: true });
      if (approvals.error) throw approvals.error;
      const current = currentDecision((approvals.data ?? []) as unknown as ApprovalRow[]);
      const state = creativeGateState({ current, now: await currentSnapshot(admin, org, { kind: 'release', id: row.id }, 'creative', rel) }, rel.items.length === 0);
      return { ...out, creative: { status: state.status, stale: state.approval?.stale === true } };
    } catch (err) {
      // 157 not applied: the gate cannot be read, so no status is shown (the release page says so itself).
      if (isMissingApprovalsSchema(err as { message: string; code?: string }) || (err instanceof Error && isMissingSchema({ message: err.message }))) return out;
      throw err;
    }
  });
  const sortedReleases = sortCreativeReleases(releases);

  // 5. The cards.
  const draftsByArtist = new Map<string, number>();
  const openByArtist = new Map<string, number>();
  for (const r of sortedReleases) {
    if (!r.artistId) continue;
    draftsByArtist.set(r.artistId, (draftsByArtist.get(r.artistId) ?? 0) + 1);
    if (creativeOpen(r.creative)) openByArtist.set(r.artistId, (openByArtist.get(r.artistId) ?? 0) + 1);
  }
  const inputs: ArtistCardInput[] = contacts.map((c) => {
    const songs = stagesByArtist.get(c.id) ?? [];
    const review = songs.filter((s) => (REVIEW_STAGES as readonly (string | null)[]).includes(s.stage));
    return {
      id: c.id,
      name: c.name,
      avatarUrl: c.avatar_url,
      direction: directions.get(c.id) ?? null,
      references: referenceCounts.get(c.id) ?? 0,
      stages: tallyStages(songs.map((s) => s.stage)),
      waiting: mayReadReviews ? review.filter((s) => !reviewed.has(s.id)).length : review.length,
      reviewed: mayReadReviews ? review.filter((s) => reviewed.has(s.id)).length : null,
      draftReleases: draftsByArtist.get(c.id) ?? 0,
      creativeOpen: openByArtist.get(c.id) ?? 0,
    };
  });
  const artists = buildArtistCards(inputs);
  return { ...base, schemaReady, artists, releases: sortedReleases, restricted, totals: workspaceTotals(artists, sortedReleases) };
}
