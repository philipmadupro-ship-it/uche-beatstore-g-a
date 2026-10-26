/**
 * Reads for the org comments routes (LABEL-22): the caller as a
 * `CommentActor`, a project's org comments, the track rules, and a song's
 * version links. The route has already authorised the caller on the PROJECT
 * (`requireProjectActor`); every read here is keyed by that org and project,
 * with the service role, and never by user. Decisions are in ./org-comments.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import type { ProjectActor } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { isUUID } from '@/lib/validate';
import { orgAudioAllowed } from './org-audio';
import { orgTrackFacts } from './org-workspace-store';
import { inviterDisplayName } from './invitation-email';
import {
  canReadInternal,
  ORG_COMMENT_COLUMNS,
  type CommentActor,
  type OrgCommentRow,
  type VersionLink,
} from './org-comments';

const COMMENT_PAGE = 2000;
export const COMMENTS_NOT_READY = 'Org comments need migration 150 applied on Supabase.';

/** The database has no migration 150 yet (a missing column or table). Routes answer `schemaReady: false` / 503. */
export class CommentsNotReadyError extends Error {
  constructor() {
    super(COMMENTS_NOT_READY);
  }
}

function failed(what: string, error: { message: string }): Error {
  return isMissingSchema(error) ? new CommentsNotReadyError() : new Error(`${what} failed: ${error.message}`);
}

/** The caller, as the pure rules see them. */
export function commentActorOf(actor: ProjectActor, projectId: string): CommentActor {
  if (actor.kind === 'org') {
    const { userId, role, capabilities } = actor.access;
    return { kind: 'org', userId, role, capabilities };
  }
  const membership = actor.access.memberships.find((m) => m.projectId.toLowerCase() === projectId.toLowerCase());
  // requireExternalProject already proved a live membership of THIS project;
  // an absent one fails closed (an unknown role comments on nothing).
  return { kind: 'external', userId: actor.access.userId, role: membership?.role ?? 'none' };
}


/** Is migration 150 there? PostgREST answers an INSERT into a missing column with a bare 404, so the POST route probes with a read first (reads report it themselves). */
export async function commentsSchemaReady(admin: AdminClient): Promise<boolean> {
  const probe = await admin.from('project_comments').select('id, org_id, visibility, resolved_at').limit(1);
  if (probe.error) {
    if (isMissingSchema(probe.error)) return false;
    throw new Error(`comments probe failed: ${probe.error.message}`);
  }
  return true;
}

/**
 * Every live org comment of the project, oldest first — rows written through
 * the org routes only: a portal thread (`contact_id`) and a guest's share-link
 * comment (`share_token`) are other conversations and never listed here. A
 * caller who cannot read internal notes is not even SENT them (the filter is
 * in the query as well as in the pure rule), so a mistake in one layer is not
 * the whole leak.
 */
export async function projectCommentRows(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  actor: CommentActor,
): Promise<OrgCommentRow[]> {
  let q = admin
    .from('project_comments')
    .select(ORG_COMMENT_COLUMNS)
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .is('contact_id', null)
    .is('share_token', null);
  if (!canReadInternal(actor)) q = q.in('visibility', ['artist']);
  // The NEWEST page: a project past the cap loses its oldest comments from the list, never its latest ones.
  const { data, error } = await q.order('created_at', { ascending: false }).limit(COMMENT_PAGE);
  if (error) throw failed('comments read', error);
  return ((data ?? []) as unknown as OrgCommentRow[]).reverse();
}

/** One comment of this org project, by id (the same population as the list). */
export async function projectCommentRow(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  commentId: string,
): Promise<OrgCommentRow | null> {
  if (!isUUID(commentId)) return null;
  const { data, error } = await admin
    .from('project_comments')
    .select(ORG_COMMENT_COLUMNS)
    .eq('id', commentId)
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .is('contact_id', null)
    .is('share_token', null)
    .maybeSingle();
  if (error) throw failed('comment read', error);
  return (data as unknown as OrgCommentRow | null) ?? null;
}

/** Is the track one of the project's recordings? */
export async function trackInProject(admin: AdminClient, projectId: string, trackId: string): Promise<boolean> {
  if (!isUUID(trackId)) return false;
  const { data, error } = await admin.from('project_tracks').select('track_id').eq('project_id', projectId).eq('track_id', trackId).limit(1);
  if (error) throw new Error(`project track read failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The tracks of `trackIds` the actor may hear, so may see the comments of
 * (D4: a member who is not allowed a demo's audio does not get notes on it).
 * An external member listens to every recording of their project (the audio
 * route is the same membership check), so all of them.
 */
export async function readableTracks(
  admin: AdminClient,
  orgId: string,
  actor: CommentActor,
  trackIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(trackIds)];
  if (ids.length === 0) return new Set();
  if (actor.kind === 'external') return new Set(ids);
  // Owner and admin hold every capability (06 §2.1) and moderate comments;
  // material nobody can classify must not put its notes out of their reach.
  if (actor.role === 'owner' || actor.role === 'admin') return new Set(ids);
  const facts = await orgTrackFacts(admin, orgId, ids);
  return new Set(ids.filter((id) => orgAudioAllowed(actor.capabilities, facts.get(id)?.requiredAudio ?? null)));
}

/** The project's recordings, in project order (ids only). */
export async function projectTrackIds(admin: AdminClient, projectId: string): Promise<string[]> {
  const placed = await admin.from('project_tracks').select('track_id, position').eq('project_id', projectId).order('position', { ascending: true });
  if (placed.error) throw new Error(`project track read failed: ${placed.error.message}`);
  return [...new Set(((placed.data ?? []) as { track_id: string }[]).map((p) => p.track_id))];
}

/** id + title of some of the org's recordings, in the order given — for the picker; nothing else about them. */
export async function recordingTitles(admin: AdminClient, orgId: string, ids: readonly string[]): Promise<{ id: string; title: string }[]> {
  if (ids.length === 0) return [];
  const tracks = await admin.from('tracks').select('id, title').in('id', [...ids]).eq('org_id', orgId);
  if (tracks.error) throw new Error(`track read failed: ${tracks.error.message}`);
  const titles = new Map(((tracks.data ?? []) as { id: string; title: string | null }[]).map((t) => [t.id, t.title]));
  return ids.filter((id) => titles.has(id)).map((id) => ({ id, title: (titles.get(id) ?? '').trim() || 'Untitled' }));
}

/** Rows the actor may read: track-less ones, and those on a track in `readable`. */
export function onReadableTracks(rows: readonly OrgCommentRow[], readable: ReadonlySet<string>): OrgCommentRow[] {
  return rows.filter((r) => r.track_id == null || readable.has(r.track_id));
}

/**
 * The version links around a track: the `version` links INTO it (to find the
 * song) and every `version` link FROM that song. Two small reads, ids
 * validated before they reach a filter.
 */
export async function versionLinksAround(admin: AdminClient, trackId: string): Promise<VersionLink[]> {
  if (!isUUID(trackId)) return [];
  const cols = 'from_track_id, to_track_id, relation, position, created_at';
  const first = await admin.from('track_links').select(cols).eq('relation', 'version').or(`from_track_id.eq.${trackId},to_track_id.eq.${trackId}`);
  if (first.error) throw new Error(`version links read failed: ${first.error.message}`);
  const rows = (first.data ?? []) as unknown as VersionLink[];
  const roots = [...new Set([trackId, ...rows.filter((l) => l.to_track_id === trackId).map((l) => l.from_track_id)])].filter(isUUID);
  const second = await admin.from('track_links').select(cols).eq('relation', 'version').in('from_track_id', roots);
  if (second.error) throw new Error(`version links read failed: ${second.error.message}`);
  const all = [...rows, ...((second.data ?? []) as unknown as VersionLink[])];
  const seen = new Set<string>();
  return all.filter((l) => {
    const key = `${l.from_track_id}>${l.to_track_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The name a comment is stored under: the caller's display name, else a neutral word — never an email. */
export async function authorNameFor(admin: AdminClient, userId: string, actor: CommentActor): Promise<string> {
  return (await inviterDisplayName(admin, userId)) ?? (actor.kind === 'external' ? 'Guest' : 'Member');
}

/** Every reply under `rootId` (any depth), for cascades. */
export async function descendantIds(admin: AdminClient, projectId: string, rootId: string): Promise<string[]> {
  const out: string[] = [];
  let frontier = [rootId];
  for (let depth = 0; depth < 20 && frontier.length > 0; depth += 1) {
    const { data, error } = await admin.from('project_comments').select('id').eq('project_id', projectId).in('parent_id', frontier);
    if (error) throw new Error(`replies read failed: ${error.message}`);
    frontier = ((data ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !out.includes(id) && id !== rootId);
    out.push(...frontier);
  }
  return out;
}

