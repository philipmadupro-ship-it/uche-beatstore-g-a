/**
 * The reads and the one write behind `POST /api/org/[orgId]/tracks/[id]/stage`
 * (LABEL-24). The rules are `song-stage.ts`; this file only touches the
 * database. Service-role client, org filter on every query: authorisation is
 * the route's (`requireObjectAccess`).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import type { EventSubject } from './activity';
import { orgTrackFacts, projectArtists } from './org-workspace-store';
import { memberSeesTrackRow } from './org-workspace';

export type StageSong = { id: string; title: string | null; type: string | null; stage: string | null };

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** The song row, or null when it is not a track of `org`. */
export async function readStageSong(admin: AdminClient, org: string, trackId: string): Promise<StageSong | null> {
  const res = await admin.from('tracks').select('id, title, type, song_stage').eq('id', trackId).eq('org_id', org).maybeSingle();
  if (res.error) fail('song read', res.error);
  const row = res.data as { id: string; title: string | null; type: string | null; song_stage: string | null } | null;
  return row ? { id: row.id, title: row.title, type: row.type, stage: row.song_stage } : null;
}

/** D4's row rule for this member: a song whose row they may not read is not theirs to move (404, as the song view answers). */
export async function memberMayReadSongRow(admin: AdminClient, org: string, trackId: string, caps: ReadonlySet<string>): Promise<boolean> {
  const facts = (await orgTrackFacts(admin, org, [trackId])).get(trackId);
  return !!facts && memberSeesTrackRow(caps, facts);
}

/**
 * Compare-and-set: the stage changes only while it is still `from`. Two people
 * moving one song at once both read the same `from`; the first write matches,
 * the second matches no row and gets `false` (a 409), never a silent overwrite.
 */
export async function moveSongStage(admin: AdminClient, o: { orgId: string; trackId: string; from: string; to: string }): Promise<boolean> {
  const res = await admin
    .from('tracks')
    .update({ song_stage: o.to })
    .eq('id', o.trackId)
    .eq('org_id', o.orgId)
    .eq('song_stage', o.from)
    .select('id');
  if (res.error) fail('stage write', res.error);
  return ((res.data as unknown[] | null) ?? []).length > 0;
}

/**
 * What the event names: the song, its first project and that project's artist,
 * so a feed scoped to an artist or a project finds it (a song-only event stays
 * hidden from a scoped member). Both context keys are best effort: a song in no
 * project still gets its event, for the whole-org feed.
 */
export async function songEventSubject(admin: AdminClient, org: string, trackId: string): Promise<EventSubject> {
  const id = trackId.toLowerCase();
  const subject: EventSubject = { type: 'track', id, songId: id, artistId: null, projectId: null };
  try {
    const links = await admin.from('project_tracks').select('project_id, position').eq('track_id', trackId);
    if (links.error) return subject;
    const ids = ((links.data ?? []) as { project_id: string }[]).map((l) => l.project_id);
    if (ids.length === 0) return subject;
    const inOrg = await admin.from('projects').select('id, inbox_for_contact_id, created_at').in('id', ids).eq('org_id', org);
    if (inOrg.error) return subject;
    // An Inbox first (it names the artist outright), then the oldest project: stable, whatever order the rows come back in.
    const projects = ((inOrg.data ?? []) as { id: string; inbox_for_contact_id: string | null; created_at?: string }[]).sort(
      (a, b) => Number(!!b.inbox_for_contact_id) - Number(!!a.inbox_for_contact_id) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id),
    );
    if (projects.length === 0) return subject;
    subject.projectId = projects[0].id;
    const artists = await projectArtists(admin, [projects[0]]);
    subject.artistId = artists.get(projects[0].id)?.[0] ?? null;
  } catch {
    // The event is best effort; the move has already happened.
  }
  return subject;
}
