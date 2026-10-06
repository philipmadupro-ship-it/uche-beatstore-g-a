/**
 * Reads for the org artist workspace, song detail and org project page
 * (LABEL-17). The `/api/org` routes and the `(label)` server pages both call
 * these after requireObjectAccess has authorised the member on the object;
 * the pure rules are ./org-workspace.
 *
 * Every read is by org (`org_id = <the object's org>`) and id — never by
 * user (06 §3.2, org-api-source-guard). Nothing here ever returns a producer
 * row (org_id IS NULL): every track, project, contact and release read
 * carries the org filter, so a junction row pointing outside the org is
 * dropped rather than followed.
 *
 * Scope rule for "this artist's projects" is the one the upload targets
 * route introduced (LABEL-14) and `can_see_org_project` holds in SQL: the
 * artist's Inbox (`projects.inbox_for_contact_id`) plus every project
 * linking them through `project_contacts`, both of the org.
 */

import type { ObjectAccessResult } from '@/lib/auth/org-access';
import { orgProjectIdsInScope } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import type { LinkedItem } from '@/lib/tracks/links';
import { scopeAllowsContact } from './artist-scope';
import { inboundLinks, parseOrgAudioVariant, requiredAudioCapabilities } from './org-audio';
import { ORG_CONTACT_COLUMNS, toOrgContactView, type OrgContactRow } from './org-contacts';
import {
  isWorkspaceSong,
  memberSeesTrackRow,
  orgWorkspacePermissions,
  partitionSongs,
  releaseItemTitles,
  visibleRecordings,
  type OrgTrackFacts,
  type OrgWorkspacePermissions,
  type RecordingView,
  type ReleaseItemTitle,
} from './org-workspace';
import { countsAsOnRelease, RELEASE_ITEM_COLUMNS, type ReleaseItemRow } from './releases';
import { songRecordings } from './recording-kind';

export type ObjectAccessOk = Extract<ObjectAccessResult, { ok: true }>;

const FULL = parseOrgAudioVariant('full')!;

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

// ── Shared reads ────────────────────────────────────────────────────────

export type OrgProjectRow = {
  id: string;
  name: string;
  cover_url: string | null;
  status: string | null;
  inbox_for_contact_id: string | null;
  created_at: string;
};

const PROJECT_COLUMNS = 'id, name, cover_url, status, inbox_for_contact_id, created_at';

/** The artist's projects of this org: their Inbox and every project linking them (LABEL-14's rule). */
export async function artistProjects(admin: AdminClient, org: string, contactId: string): Promise<OrgProjectRow[]> {
  const [inboxRes, linkedRes] = await Promise.all([
    admin.from('projects').select('id').eq('org_id', org).eq('inbox_for_contact_id', contactId),
    admin.from('project_contacts').select('project_id').eq('contact_id', contactId),
  ]);
  const ids = [
    ...rows<{ id: string }>(inboxRes, 'inbox lookup').map((p) => p.id),
    ...rows<{ project_id: string }>(linkedRes, 'project link lookup').map((p) => p.project_id),
  ];
  if (ids.length === 0) return [];
  const projects = rows<OrgProjectRow>(
    await admin.from('projects').select(PROJECT_COLUMNS).in('id', [...new Set(ids)]).eq('org_id', org),
    'project read',
  );
  // Inbox first, then newest.
  return projects.sort((a, b) => Number(!!b.inbox_for_contact_id) - Number(!!a.inbox_for_contact_id) || b.created_at.localeCompare(a.created_at));
}

/**
 * Row and audio facts for org tracks, read the way the audio route reads
 * them (raw inbound links, undeduplicated; a song's release membership).
 * A track missing from the result is not an org track of `org`: callers
 * treat it as invisible (fail closed).
 */
export async function orgTrackFacts(admin: AdminClient, org: string, trackIds: readonly string[]): Promise<Map<string, OrgTrackFacts>> {
  const ids = [...new Set(trackIds)];
  const out = new Map<string, OrgTrackFacts>();
  if (ids.length === 0) return out;
  const [tracksRes, beatsRes, linksRes, mainBeatRes] = await Promise.all([
    admin.from('tracks').select('id, type, song_stage').in('id', ids).eq('org_id', org),
    admin.from('song_beats').select('song_track_id, beat_track_id').in('beat_track_id', ids),
    admin.from('track_links').select('from_track_id, to_track_id, relation').in('to_track_id', ids),
    admin.from('tracks').select('id, beat_track_id').in('beat_track_id', ids).eq('org_id', org),
  ]);
  const tracks = rows<{ id: string; type: string | null; song_stage: string | null }>(tracksRes, 'track read');
  const beats = rows<{ song_track_id: string; beat_track_id: string }>(beatsRes, 'song_beats read');
  const links = rows<{ from_track_id: string; to_track_id: string; relation: string }>(linksRes, 'track_links read');
  const mainBeat = rows<{ id: string; beat_track_id: string }>(mainBeatRes, 'main beat read');

  const fromIds = [...new Set([...beats.map((b) => b.song_track_id), ...links.map((l) => l.from_track_id), ...mainBeat.map((m) => m.id)])];
  const types = new Map<string, string | null>();
  if (fromIds.length > 0) {
    const fromRows = rows<{ id: string; type: string | null }>(
      await admin.from('tracks').select('id, type').in('id', fromIds).eq('org_id', org),
      'linked track read',
    );
    for (const r of fromRows) types.set(r.id, r.type);
  }

  const songIds = tracks.filter((t) => t.type === 'song').map((t) => t.id);
  const onRelease = await songsOnRelease(admin, org, songIds);

  for (const t of tracks) {
    const raw = {
      songBeats: beats.filter((b) => b.beat_track_id === t.id),
      links: links.filter((l) => l.to_track_id === t.id),
      mainBeatOf: mainBeat.filter((m) => m.beat_track_id === t.id).map((m) => m.id),
    };
    const inbound = inboundLinks(raw, types);
    const track = { type: t.type, song_stage: t.song_stage, on_release: onRelease.has(t.id) };
    out.set(t.id, { ...track, inbound, requiredAudio: requiredAudioCapabilities(track, inbound, FULL) });
  }
  return out;
}

/** Songs that are items of a release that is not cancelled. Before migration 144 there are none. */
async function songsOnRelease(admin: AdminClient, org: string, songIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (songIds.length === 0) return out;
  const res = await admin
    .from('release_items')
    .select('song_track_id, release_id, releases!inner(state)')
    .in('song_track_id', [...songIds])
    .eq('org_id', org);
  if (res.error) {
    if (isMissingSchema(res.error)) return out;
    throw new Error(`release lookup: ${res.error.message}`);
  }
  const bySong = new Map<string, { releases: { state: string } | null }[]>();
  for (const r of (res.data ?? []) as unknown as { song_track_id: string; releases: { state: string } | null }[]) {
    bySong.set(r.song_track_id, [...(bySong.get(r.song_track_id) ?? []), r]);
  }
  for (const [id, list] of bySong) if (countsAsOnRelease(list)) out.add(id);
  return out;
}

/** The roster contacts of some projects of the org (inbox artist + project_contacts), as names. */
export async function projectArtists(
  admin: AdminClient,
  projects: ReadonlyArray<{ id: string; inbox_for_contact_id: string | null }>,
): Promise<Map<string, string[]>> {
  const byProject = new Map<string, string[]>(projects.map((p) => [p.id, p.inbox_for_contact_id ? [p.inbox_for_contact_id] : []]));
  if (projects.length === 0) return byProject;
  const links = rows<{ project_id: string; contact_id: string }>(
    await admin.from('project_contacts').select('project_id, contact_id').in('project_id', projects.map((p) => p.id)),
    'project link read',
  );
  for (const l of links) byProject.get(l.project_id)?.push(l.contact_id);
  return byProject;
}

async function contactNames(admin: AdminClient, org: string, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const res = rows<{ id: string; name: string }>(await admin.from('contacts').select('id, name').in('id', unique).eq('org_id', org), 'contact read');
  for (const c of res) out.set(c.id, c.name);
  return out;
}

/** For a scoped member: is the track in at least one project they can see? null scope = whole org. */
async function trackScope(admin: AdminClient, access: ObjectAccessOk, trackIds: readonly string[]): Promise<(id: string) => boolean> {
  if (access.artistScope === null) return () => true;
  const scoped = new Set(await orgProjectIdsInScope(admin, access) ?? []);
  if (trackIds.length === 0) return () => false;
  const links = rows<{ project_id: string; track_id: string }>(
    await admin.from('project_tracks').select('project_id, track_id').in('track_id', [...new Set(trackIds)]),
    'project track read',
  );
  const ok = new Set(links.filter((l) => scoped.has(l.project_id)).map((l) => l.track_id));
  return (id) => ok.has(id);
}

// ── Artist workspace ────────────────────────────────────────────────────

export type OrgWorkspaceSong = {
  id: string;
  title: string | null;
  stage: string | null;
  cover_url: string | null;
  created_at: string;
  projects: { id: string; name: string }[];
};

export type OrgWorkspaceProject = {
  id: string;
  name: string;
  cover_url: string | null;
  status: string | null;
  isInbox: boolean;
  /** Songs in it the member sees. */
  songs: number;
};

export type OrgWorkspaceRelease = {
  id: string;
  title: string;
  type: string;
  state: string;
  targetDate: string | null;
  releaseDate: string | null;
  projectId: string;
  items: ReleaseItemTitle[];
};

export type OrgArtistWorkspace = {
  contact: { id: string; name: string; avatar_url: string | null; category: string | null; secondary_category: string | null };
  projects: OrgWorkspaceProject[];
  songs: OrgWorkspaceSong[];
  /** Songs of this artist the member may not see (working material, D4): "restricted", never named. */
  restrictedSongs: number;
  releases: OrgWorkspaceRelease[];
  /** False before migration 144: the Releases tab says so. */
  releasesReady: boolean;
  permissions: OrgWorkspacePermissions;
};

type TrackRow = { id: string; title: string | null; type: string | null; song_stage: string | null; cover_url: string | null; created_at: string };

/** `access` is requireObjectAccess on `contacts` (catalog.read): the artist, in the member's scope. */
export async function loadOrgArtistWorkspace(access: ObjectAccessOk): Promise<OrgArtistWorkspace | null> {
  const { admin } = access;
  const org = access.object.orgId;
  const contactId = access.object.id;

  const contactRows = rows<OrgContactRow>(
    await admin.from('contacts').select(ORG_CONTACT_COLUMNS).eq('org_id', org).eq('id', contactId),
    'contact read',
  );
  if (contactRows.length === 0) return null;
  const contact = toOrgContactView(contactRows[0]);

  const projects = await artistProjects(admin, org, contactId);
  const projectIds = projects.map((p) => p.id);
  const placements = projectIds.length
    ? rows<{ project_id: string; track_id: string }>(
      await admin.from('project_tracks').select('project_id, track_id').in('project_id', projectIds),
      'project track read',
    )
    : [];
  const trackIds = [...new Set(placements.map((p) => p.track_id))];
  const tracks = trackIds.length
    ? rows<TrackRow>(
      await admin.from('tracks').select('id, title, type, song_stage, cover_url, created_at').in('id', trackIds).eq('org_id', org),
      'track read',
    )
    : [];
  const candidates = tracks.filter(isWorkspaceSong);
  const facts = await orgTrackFacts(admin, org, candidates.map((t) => t.id));
  const caps = access.capabilities;
  const { visible, hidden } = partitionSongs(candidates, facts, caps);

  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const songs: OrgWorkspaceSong[] = visible
    .map((t) => ({
      id: t.id,
      title: t.title,
      stage: t.song_stage,
      cover_url: t.cover_url,
      created_at: t.created_at,
      projects: placements.filter((p) => p.track_id === t.id && nameOf.has(p.project_id)).map((p) => ({ id: p.project_id, name: nameOf.get(p.project_id)! })),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const visibleIds = new Set(songs.map((s) => s.id));

  const releases = await artistReleases(access, contactId);

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      avatar_url: contact.avatar_url,
      category: contact.category,
      secondary_category: contact.secondary_category,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      cover_url: p.cover_url,
      status: p.status,
      isInbox: p.inbox_for_contact_id === contactId,
      songs: new Set(placements.filter((pl) => pl.project_id === p.id && visibleIds.has(pl.track_id)).map((pl) => pl.track_id)).size,
    })),
    songs,
    restrictedSongs: hidden,
    releases: releases.list,
    releasesReady: releases.ready,
    permissions: orgWorkspacePermissions(caps),
  };
}

type ReleaseListRow = { id: string; project_id: string; title: string; type: string; state: string; target_date: string | null; release_date: string | null; created_at: string };

/** The artist's releases the member can see (by their project, 144's read rule), with titled tracklists. */
async function artistReleases(access: ObjectAccessOk, contactId: string): Promise<{ ready: boolean; list: OrgWorkspaceRelease[] }> {
  const { admin } = access;
  const org = access.object.orgId;
  const scoped = await orgProjectIdsInScope(admin, access);
  if (scoped !== null && scoped.length === 0) return { ready: true, list: [] };
  let q = admin
    .from('releases')
    .select('id, project_id, title, type, state, target_date, release_date, created_at')
    .eq('org_id', org)
    .eq('contact_id', contactId);
  if (scoped !== null) q = q.in('project_id', scoped);
  const res = await q.order('created_at', { ascending: false });
  if (res.error) {
    if (isMissingSchema(res.error)) return { ready: false, list: [] };
    throw new Error(`release read: ${res.error.message}`);
  }
  const list = (res.data ?? []) as ReleaseListRow[];
  if (list.length === 0) return { ready: true, list: [] };

  const items = rows<ReleaseItemRow>(
    await admin.from('release_items').select(RELEASE_ITEM_COLUMNS).in('release_id', list.map((r) => r.id)).eq('org_id', org),
    'release item read',
  );
  const songIds = [...new Set(items.map((i) => i.song_track_id))];
  const [facts, titleRows] = await Promise.all([
    orgTrackFacts(admin, org, songIds),
    songIds.length ? admin.from('tracks').select('id, title').in('id', songIds).eq('org_id', org) : Promise.resolve({ data: [], error: null }),
  ]);
  const titles = new Map(rows<{ id: string; title: string | null }>(titleRows, 'release song read').map((t) => [t.id, t.title]));
  const visible = (id: string) => {
    const f = facts.get(id);
    return !!f && memberSeesTrackRow(access.capabilities, f);
  };
  return {
    ready: true,
    list: list.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      state: r.state,
      targetDate: r.target_date,
      releaseDate: r.release_date,
      projectId: r.project_id,
      items: releaseItemTitles(items.filter((i) => i.release_id === r.id), titles, visible),
    })),
  };
}

// ── Song detail ─────────────────────────────────────────────────────────

export type OrgSongDetail = {
  song: { id: string; title: string | null; stage: string | null; cover_url: string | null; bpm: number | null; key: string | null; duration_seconds: number | null };
  artists: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  recordings: RecordingView[];
  /** Recordings of this song the member may not hear: "restricted", never named. */
  restrictedRecordings: number;
  releases: { id: string; title: string; state: string }[];
};

type SongRow = TrackRow & { bpm: number | null; key: string | null; duration_seconds: number | null; beat_track_id: string | null };

/**
 * `access` is requireObjectAccess on `tracks` (catalog.read). Null when the
 * track is not a workspace song (a master, a beat) or its row is one the
 * member may not see — the route answers 404, as PostgREST would show
 * nothing.
 */
export async function loadOrgSong(access: ObjectAccessOk): Promise<OrgSongDetail | null> {
  const { admin } = access;
  const org = access.object.orgId;
  const id = access.object.id;
  const songRows = rows<SongRow>(
    await admin
      .from('tracks')
      .select('id, title, type, song_stage, cover_url, created_at, bpm, key, duration_seconds, beat_track_id')
      .eq('id', id)
      .eq('org_id', org),
    'song read',
  );
  const song = songRows[0];
  if (!song || !isWorkspaceSong(song)) return null;

  // Material linked FROM the song, one hop (the reads mergeLinks makes for it).
  const [beatsRes, linksRes] = await Promise.all([
    admin.from('song_beats').select('beat_track_id, position').eq('song_track_id', id),
    admin.from('track_links').select('to_track_id, relation, position').eq('from_track_id', id),
  ]);
  const beats = rows<{ beat_track_id: string; position: number }>(beatsRes, 'song_beats read').sort((a, b) => a.position - b.position);
  const links = rows<{ to_track_id: string; relation: string; position: number }>(linksRes, 'track_links read');
  const beatIds = beats.map((b) => b.beat_track_id);
  if (song.beat_track_id && !beatIds.includes(song.beat_track_id)) beatIds.unshift(song.beat_track_id);
  const linkedIds = [...new Set([...beatIds, ...links.map((l) => l.to_track_id)])];
  const linkedRows = linkedIds.length
    ? rows<{ id: string; title: string | null; type: string | null; duration_seconds: number | null }>(
      await admin.from('tracks').select('id, title, type, duration_seconds').in('id', linkedIds).eq('org_id', org),
      'linked track read',
    )
    : [];
  const byId = new Map(linkedRows.map((t) => [t.id, t]));
  const linked: LinkedItem[] = [];
  beatIds.forEach((b, position) => {
    const t = byId.get(b);
    if (t) linked.push({ relation: 'beat', direction: 'out', track: { id: t.id, title: t.title, type: t.type }, position });
  });
  for (const l of links) {
    const t = byId.get(l.to_track_id);
    if (t) linked.push({ relation: l.relation as LinkedItem['relation'], direction: 'out', track: { id: t.id, title: t.title, type: t.type }, position: l.position });
  }

  const facts = await orgTrackFacts(admin, org, [id, ...byId.keys()]);
  const own = facts.get(id);
  const caps = access.capabilities;
  if (!own || !memberSeesTrackRow(caps, own)) return null;

  const recs = songRecordings({ id, title: song.title, type: song.type, song_stage: song.song_stage as never }, linked, { onRelease: own.on_release });
  const inScope = await trackScope(admin, access, [id, ...byId.keys()]);
  const durations = new Map<string, number | null>([[id, song.duration_seconds], ...linkedRows.map((t) => [t.id, t.duration_seconds] as [string, number | null])]);
  const { recordings, restricted } = visibleRecordings(recs, facts, caps, { inScope, durations });

  // Where the song lives, and whose it is — only what the member can see.
  const placements = rows<{ project_id: string }>(await admin.from('project_tracks').select('project_id').eq('track_id', id), 'project track read');
  let projects: OrgProjectRow[] = placements.length
    ? rows<OrgProjectRow>(await admin.from('projects').select(PROJECT_COLUMNS).in('id', placements.map((p) => p.project_id)).eq('org_id', org), 'project read')
    : [];
  const scopedProjects = await orgProjectIdsInScope(admin, access);
  if (scopedProjects !== null) projects = projects.filter((p) => scopedProjects.includes(p.id));
  const artistsBy = await projectArtists(admin, projects);
  const artistIds = [...new Set([...artistsBy.values()].flat())].filter((c) => scopeAllowsContact(access.artistScope, c));
  const names = await contactNames(admin, org, artistIds);

  const releasesRes = await admin
    .from('release_items')
    .select('release_id, releases!inner(id, title, state, project_id)')
    .eq('song_track_id', id)
    .eq('org_id', org);
  let releases: OrgSongDetail['releases'] = [];
  if (releasesRes.error) {
    if (!isMissingSchema(releasesRes.error)) throw new Error(`release read: ${releasesRes.error.message}`);
  } else {
    const seen = new Set<string>();
    for (const r of (releasesRes.data ?? []) as unknown as { releases: { id: string; title: string; state: string; project_id: string } | null }[]) {
      const rel = r.releases;
      if (!rel || seen.has(rel.id)) continue;
      if (scopedProjects !== null && !scopedProjects.includes(rel.project_id)) continue;
      seen.add(rel.id);
      releases.push({ id: rel.id, title: rel.title, state: rel.state });
    }
    releases = releases.sort((a, b) => a.title.localeCompare(b.title));
  }

  return {
    song: {
      id,
      title: song.title,
      stage: song.song_stage,
      cover_url: song.cover_url,
      bpm: song.bpm,
      key: song.key,
      duration_seconds: song.duration_seconds,
    },
    artists: artistIds.filter((c) => names.has(c)).map((c) => ({ id: c, name: names.get(c)! })),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    recordings,
    restrictedRecordings: restricted,
    releases,
  };
}

// ── Org project ─────────────────────────────────────────────────────────

export type OrgProjectDetail = {
  project: { id: string; name: string; cover_url: string | null; status: string | null; isInbox: boolean };
  artists: { id: string; name: string }[];
  songs: OrgWorkspaceSong[];
  restrictedSongs: number;
};

/** `access` is requireObjectAccess on `projects` (catalog.read). */
export async function loadOrgProject(access: ObjectAccessOk): Promise<OrgProjectDetail | null> {
  const { admin } = access;
  const org = access.object.orgId;
  const id = access.object.id;
  const projectRows = rows<OrgProjectRow>(await admin.from('projects').select(PROJECT_COLUMNS).eq('id', id).eq('org_id', org), 'project read');
  const project = projectRows[0];
  if (!project) return null;
  const placements = rows<{ track_id: string }>(await admin.from('project_tracks').select('track_id').eq('project_id', id), 'project track read');
  const trackIds = [...new Set(placements.map((p) => p.track_id))];
  const tracks = trackIds.length
    ? rows<TrackRow>(await admin.from('tracks').select('id, title, type, song_stage, cover_url, created_at').in('id', trackIds).eq('org_id', org), 'track read')
    : [];
  const candidates = tracks.filter(isWorkspaceSong);
  const facts = await orgTrackFacts(admin, org, candidates.map((t) => t.id));
  const { visible, hidden } = partitionSongs(candidates, facts, access.capabilities);
  const artistsBy = await projectArtists(admin, [project]);
  const artistIds = (artistsBy.get(id) ?? []).filter((c) => scopeAllowsContact(access.artistScope, c));
  const names = await contactNames(admin, org, artistIds);
  return {
    project: { id: project.id, name: project.name, cover_url: project.cover_url, status: project.status, isInbox: !!project.inbox_for_contact_id },
    artists: [...new Set(artistIds)].filter((c) => names.has(c)).map((c) => ({ id: c, name: names.get(c)! })),
    songs: visible
      .map((t) => ({ id: t.id, title: t.title, stage: t.song_stage, cover_url: t.cover_url, created_at: t.created_at, projects: [{ id: project.id, name: project.name }] }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    restrictedSongs: hidden,
  };
}
