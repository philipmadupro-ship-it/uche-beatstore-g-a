/**
 * The A&R inbox's read (LABEL-25, 04 W3 step 3): the songs in `inbox` and
 * `in_review` that THIS member may read — artist scope (the same projects
 * `can_see_org_track` reaches), then D4's row rule (`partitionSongs`) — oldest
 * first, each with its artist, the viewer's own review and everyone's rating
 * summary. Service-role reads, org filter on every query; authorisation is the
 * route's (`requireOrgCapability` catalog.read).
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { orgProjectIdsInScope } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { orgTrackFacts, projectArtists } from './org-workspace-store';
import { partitionSongs } from './org-workspace';
import { INBOX_STAGES, mayReview, sortInbox, summarizeReviews, type ReviewContent, type ReviewSummary } from './song-review';
import { reviewsForSongs } from './song-review-store';
import { SONG_STAGES } from './song-stage';

export type ArInboxSong = {
  id: string;
  title: string | null;
  stage: string;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  duration_seconds: number | null;
  created_at: string;
  artist: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  mine: ReviewContent | null;
  summary: ReviewSummary;
};

export type ArInbox = {
  songs: ArInboxSong[];
  /** Songs in the inbox stages the member may not read (D4): counted, never named. */
  restricted: number;
  canReview: boolean;
};

type TrackRow = {
  id: string;
  title: string | null;
  song_stage: string | null;
  type: string | null;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  duration_seconds: number | null;
  created_at: string;
};

const COLUMNS = 'id, title, type, song_stage, cover_url, bpm, key, duration_seconds, created_at';

/** PostgREST puts an `in` list in the URL: keep each read well under its length limit. */
const CHUNK = 100;
function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown as T)) as T;
}

/** Org songs in the inbox stages inside the member's reach (null project list = whole org). */
async function inboxCandidates(admin: AdminClient, org: string, scoped: string[] | null): Promise<TrackRow[]> {
  if (scoped === null) {
    return must(await admin.from('tracks').select(COLUMNS).eq('org_id', org).eq('type', 'song').in('song_stage', [...INBOX_STAGES]), 'inbox read') as TrackRow[];
  }
  if (scoped.length === 0) return [];
  const placements = await Promise.all(chunks(scoped).map(async (part) => must(await admin.from('project_tracks').select('track_id').in('project_id', part), 'inbox placement read') as { track_id: string }[]));
  const ids = [...new Set(placements.flat().map((l) => l.track_id))];
  const reads = await Promise.all(chunks(ids).map(async (part) =>
    must(await admin.from('tracks').select(COLUMNS).in('id', part).eq('org_id', org).eq('type', 'song').in('song_stage', [...INBOX_STAGES]), 'inbox read') as TrackRow[]));
  return reads.flat();
}

export async function loadArInbox(access: OrgAccessOk): Promise<ArInbox> {
  const { admin, orgId: org } = access;
  const scoped = await orgProjectIdsInScope(admin, access);
  const candidates = (await inboxCandidates(admin, org, scoped)).filter((t) => (SONG_STAGES as readonly (string | null)[]).includes(t.song_stage));
  const facts = await orgTrackFacts(admin, org, candidates.map((t) => t.id));
  const { visible, hidden } = partitionSongs(candidates, facts, access.capabilities);
  const ordered = sortInbox(visible.map((t) => ({ ...t, stage: t.song_stage as string })));
  if (ordered.length === 0) return { songs: [], restricted: hidden, canReview: mayReview(access.capabilities) };

  const ids = ordered.map((t) => t.id);
  // Ratings are read by members with a review ability only (migration 149's policy asks the same).
  const mayRead = access.capabilities.has('review.comment');
  const [placements, reviewParts] = await Promise.all([
    Promise.all(chunks(ids).map(async (part) => must(await admin.from('project_tracks').select('project_id, track_id').in('track_id', part), 'inbox placement read') as { project_id: string; track_id: string }[])),
    mayRead ? Promise.all(chunks(ids).map((part) => reviewsForSongs(admin, org, part))) : Promise.resolve([]),
  ]);
  const links = placements.flat();
  const reviews = new Map<string, Awaited<ReturnType<typeof reviewsForSongs>> extends Map<string, infer V> ? V : never>();
  for (const m of reviewParts) for (const [k, v] of m) reviews.set(k, v);
  const projectIds = [...new Set(links.map((l) => l.project_id))];
  const projects = projectIds.length
    ? (await Promise.all(chunks(projectIds).map(async (part) => must(await admin.from('projects').select('id, name, inbox_for_contact_id, created_at').in('id', part).eq('org_id', org), 'project read') as { id: string; name: string; inbox_for_contact_id: string | null; created_at: string }[]))).flat()
    : [];
  const artistIdsByProject = new Map<string, string[]>();
  for (const part of await Promise.all(chunks(projects).map((p) => projectArtists(admin, p)))) for (const [k, v] of part) artistIdsByProject.set(k, v);
  const contactIds = [...new Set([...artistIdsByProject.values()].flat())];
  const contacts = contactIds.length
    ? (await Promise.all(chunks(contactIds).map(async (part) => must(await admin.from('contacts').select('id, name').in('id', part).eq('org_id', org), 'contact read') as { id: string; name: string }[]))).flat()
    : [];
  const nameOf = new Map(contacts.map((c) => [c.id, c.name]));
  // An Inbox project first (it names the artist outright), then the oldest: the same pick as the song's event.
  const rank = (p: { inbox_for_contact_id: string | null; created_at: string; id: string }) => [Number(!p.inbox_for_contact_id), p.created_at, p.id] as const;
  const projectsByTrack = new Map<string, typeof projects>();
  for (const l of links) {
    const p = projects.find((x) => x.id === l.project_id);
    if (p) projectsByTrack.set(l.track_id, [...(projectsByTrack.get(l.track_id) ?? []), p]);
  }

  const songs = ordered.map((t): ArInboxSong => {
    const mine = (reviews.get(t.id) ?? []).find((r) => r.reviewerId === access.userId) ?? null;
    const all = reviews.get(t.id) ?? [];
    const first = [...(projectsByTrack.get(t.id) ?? [])].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1].localeCompare(rb[1]) || ra[2].localeCompare(rb[2]);
    })[0];
    // A scoped member is shown only an artist they can see; a whole-org member any.
    const artistId = first ? (artistIdsByProject.get(first.id) ?? []).find((id) => access.artistScope === null || access.artistScope.has(id)) ?? null : null;
    return {
      id: t.id,
      title: t.title,
      stage: t.stage,
      cover_url: t.cover_url,
      bpm: t.bpm,
      key: t.key,
      duration_seconds: t.duration_seconds,
      created_at: t.created_at,
      artist: artistId && nameOf.has(artistId) ? { id: artistId, name: nameOf.get(artistId)! } : null,
      project: first ? { id: first.id, name: first.name } : null,
      mine: mine ? { rating: mine.rating, verdict: mine.verdict, note: mine.note } : null,
      summary: summarizeReviews(all),
    };
  });
  return { songs, restricted: hidden, canReview: mayReview(access.capabilities) };
}
