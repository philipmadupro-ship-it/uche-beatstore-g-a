/**
 * The reads behind Needs attention (LABEL-35). Called by
 * `GET /api/org/[orgId]/attention` and the `/o/<slug>` server page after
 * `requireOrgCapability('catalog.read')` authorised the member. The rules are
 * the pure `attention.ts`; this file only reads, and applies the member's
 * scope and D4 BEFORE anything is handed over:
 *
 *  - releases come from the member's projects (`orgProjectIdsInScope`, 144's
 *    rule), drafts with a target date inside the threshold only, each judged
 *    by LABEL-32's `evaluateReleaseReadiness` (blockers, never the percentage);
 *  - songs come from the same project walk, split by `partitionSongs` (D4), so
 *    one the member may not read is a number and never a title;
 *  - tasks go through LABEL-23's `visibleTasks` — maker, assignee or
 *    owner/admin, inside the artist scope — so a member sees their own overdue
 *    work and an owner sees everyone's.
 *
 * Every read carries `org_id`. Nothing is stored: the list is computed on
 * every request, which is why there is no precomputing cron (the optional cron
 * of the backlog would need a table to be of any use).
 *
 * A source whose migration is not applied (releases 144–157, tasks 151,
 * activity 136) contributes nothing instead of failing the section.
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { orgProjectIdsInScope, scopedOrgQuery } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { parseAttentionSettings, type OrgAttentionSettings } from '@/lib/contracts';
import { memberIdentities, memberLabel, type IdentityAdmin } from './member-identity';
import { computeAttention, STALLABLE_STAGES, type AttentionInput, type AttentionPerson, type AttentionRelease, type AttentionSong, type AttentionTask, type AttentionItem } from './attention';
import { ORG_CONTACT_COLUMNS, toOrgContactView, type OrgContactRow } from './org-contacts';
import { isWorkspaceSong, partitionSongs, type OrgTrackFacts } from './org-workspace';
import { orgTrackFacts } from './org-workspace-store';
import { chunks, inChunks, pageAll, ReadError } from './overview-store';
import { APPROVAL_GATE, evaluateReleaseReadiness, RELEASE_GATES } from './release-readiness';
import { loadReleaseReadinessFacts, ReleaseReadinessNotReadyError } from './release-readiness-store';
import { toTaskRow, visibleTasks } from './tasks-store';

export type AttentionView = {
  items: AttentionItem[];
  /** Stalled songs the member may not read (D4). */
  restricted: number;
  /** False when releases cannot be evaluated yet (a migration is missing): the section says so. */
  releasesReady: boolean;
};

/** Releases evaluated per read: the nearest dates first, the rest are not looked at. */
const RELEASE_CAP = 50;
const RELEASE_CONCURRENCY = 5;
const DAY = 86_400_000;

type Admin = OrgAccessOk['admin'];

async function readSettings(admin: Admin, orgId: string): Promise<OrgAttentionSettings> {
  const res = await admin.from('organizations').select('settings').eq('id', orgId).maybeSingle();
  if (res.error) throw new Error(`org settings read: ${res.error.message}`);
  return parseAttentionSettings((res.data as { settings?: unknown } | null)?.settings);
}

/** Display names for user ids, no emails. */
async function labels(admin: Admin, orgId: string, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
  const names = await memberIdentities(admin as unknown as IdentityAdmin, orgId, unique, { withEmail: false });
  return new Map(unique.map((id) => [id, memberLabel(names.get(id))]));
}

function person(names: ReadonlyMap<string, string>, id: string | null | undefined): AttentionPerson | null {
  if (!id) return null;
  const key = id.toLowerCase();
  return { id: key, name: names.get(key) ?? 'Member' };
}

type RosterArtist = { id: string; name: string };

async function readRoster(access: OrgAccessOk): Promise<RosterArtist[]> {
  const rows = await pageAll<OrgContactRow>(
    (from, to) => scopedOrgQuery(access.admin, 'contacts', access, ORG_CONTACT_COLUMNS).order('name', { ascending: true }).order('id').range(from, to),
    'contact read',
  );
  return rows
    .map(toOrgContactView)
    .filter((c) => c.in_roster)
    .map((c) => ({ id: c.id.toLowerCase(), name: c.name }));
}

// ── Songs ───────────────────────────────────────────────────────────────

type SongRow = { id: string; title: string | null; type: string | null; song_stage: string | null; created_at: string; created_by: string | null };

async function readSongs(access: OrgAccessOk, roster: readonly RosterArtist[], scoped: string[] | null, settings: OrgAttentionSettings, now: Date): Promise<AttentionSong[]> {
  const { admin, orgId } = access;
  if (scoped !== null && scoped.length === 0) return [];
  type ProjectRow = { id: string; inbox_for_contact_id: string | null };
  const projects = scoped === null
    ? await pageAll<ProjectRow>((from, to) => admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', orgId).order('id').range(from, to), 'project read')
    : await inChunks<ProjectRow>(scoped, (part, from, to) => admin.from('projects').select('id, inbox_for_contact_id').eq('org_id', orgId).in('id', part).order('id').range(from, to), 'project read');
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return [];

  const [links, placements] = await Promise.all([
    inChunks<{ project_id: string; contact_id: string }>(projectIds, (part, from, to) => admin.from('project_contacts').select('project_id, contact_id').in('project_id', part).order('project_id').order('contact_id').range(from, to), 'project link read'),
    inChunks<{ project_id: string; track_id: string }>(projectIds, (part, from, to) => admin.from('project_tracks').select('project_id, track_id').in('project_id', part).order('project_id').order('track_id').range(from, to), 'project track read'),
  ]);
  const rosterIds = new Map(roster.map((a) => [a.id, a]));
  const projectArtists = new Map<string, string[]>(projects.map((p) => [p.id, p.inbox_for_contact_id ? [p.inbox_for_contact_id.toLowerCase()] : []]));
  for (const l of links) projectArtists.get(l.project_id)?.push(l.contact_id.toLowerCase());

  // A song cannot have been stuck longer than it has existed: older-than-threshold rows only.
  const cutoff = new Date(now.getTime() - settings.attention_stalled_days * DAY).toISOString();
  const tracks = await inChunks<SongRow>(
    placements.map((p) => p.track_id),
    (part, from, to) =>
      admin
        .from('tracks')
        .select('id, title, type, song_stage, created_at, created_by')
        .in('id', part)
        .eq('org_id', orgId)
        .in('song_stage', [...STALLABLE_STAGES])
        .lt('created_at', cutoff)
        .order('id')
        .range(from, to),
    'track read',
  );
  const candidates = tracks.filter(isWorkspaceSong);
  if (candidates.length === 0) return [];

  // D4: which of them the member may read.
  const facts = new Map<string, OrgTrackFacts>();
  for (const part of await Promise.all(chunks(candidates.map((t) => t.id)).map((ids) => orgTrackFacts(admin, orgId, ids)))) {
    for (const [id, f] of part) facts.set(id, f);
  }
  const readable = new Set(partitionSongs(candidates, facts, access.capabilities).visible.map((t) => t.id));

  // When each entered its stage, and who moved it there.
  const moved = new Map<string, { at: string; actor: string | null }>();
  try {
    const events = await inChunks<{ song_id: string | null; actor_id: string | null; payload: { to?: unknown } | null; created_at: string; id: string }>(
      candidates.map((t) => t.id),
      (part, from, to) =>
        admin
          .from('activity_events')
          .select('id, song_id, actor_id, payload, created_at')
          .eq('org_id', orgId)
          .eq('verb', 'song.stage_changed')
          .in('song_id', part)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      'stage event read',
    );
    const stageOf = new Map(candidates.map((t) => [t.id, t.song_stage]));
    for (const e of events) {
      if (!e.song_id || moved.has(e.song_id)) continue;
      // A move out of another stage into the current one; an event for any other target is history.
      if (typeof e.payload?.to === 'string' && e.payload.to !== stageOf.get(e.song_id)) continue;
      moved.set(e.song_id, { at: e.created_at, actor: e.actor_id });
    }
  } catch (err) {
    if (!(err instanceof ReadError && isMissingSchema(err.raw))) throw err;
  }

  const names = await labels(admin, orgId, candidates.flatMap((t) => [moved.get(t.id)?.actor, t.created_by]));
  const songArtists = new Map<string, Set<string>>();
  for (const p of placements) {
    const set = songArtists.get(p.track_id) ?? new Set<string>();
    for (const c of projectArtists.get(p.project_id) ?? []) if (rosterIds.has(c)) set.add(c);
    songArtists.set(p.track_id, set);
  }
  return candidates.map((t): AttentionSong => {
    const mine = roster.filter((a) => songArtists.get(t.id)?.has(a.id));
    const m = moved.get(t.id);
    return {
      id: t.id,
      title: t.title,
      artistIds: mine.map((a) => a.id),
      artistName: mine[0]?.name ?? null,
      stage: t.song_stage,
      since: m?.at ?? t.created_at,
      person: person(names, m?.actor ?? t.created_by),
      readable: readable.has(t.id),
    };
  });
}

// ── Releases ────────────────────────────────────────────────────────────

type ReleaseRow = { id: string; project_id: string; contact_id: string; title: string; target_date: string; created_by: string | null };

async function readReleases(access: OrgAccessOk, roster: readonly RosterArtist[], scoped: string[] | null, settings: OrgAttentionSettings, now: Date): Promise<{ ready: boolean; list: AttentionRelease[] }> {
  const { admin, orgId } = access;
  if (scoped !== null && scoped.length === 0) return { ready: true, list: [] };
  const horizon = new Date(now.getTime() + settings.attention_release_days * DAY).toISOString().slice(0, 10);

  let rows: ReleaseRow[];
  try {
    rows = await pageAll<ReleaseRow>(
      (from, to) =>
        admin
          .from('releases')
          .select('id, project_id, contact_id, title, target_date, created_by')
          .eq('org_id', orgId)
          .eq('state', 'draft')
          .not('target_date', 'is', null)
          .lte('target_date', horizon)
          .order('target_date', { ascending: true })
          .order('id')
          .range(from, to),
      'release read',
    );
  } catch (err) {
    if (err instanceof ReadError && isMissingSchema(err.raw)) return { ready: false, list: [] };
    throw err;
  }
  const allowed = scoped === null ? null : new Set(scoped);
  rows = rows.filter((r) => allowed === null || allowed.has(r.project_id)).slice(0, RELEASE_CAP);
  if (rows.length === 0) return { ready: true, list: [] };

  let ready = true;
  const evaluated: Array<{ row: ReleaseRow; gates: Array<{ gate: (typeof RELEASE_GATES)[number]; blocked: boolean; approver: string | null }> } | null> = [];
  for (let i = 0; i < rows.length; i += RELEASE_CONCURRENCY) {
    evaluated.push(
      ...(await Promise.all(
        rows.slice(i, i + RELEASE_CONCURRENCY).map(async (row) => {
          try {
            const facts = await loadReleaseReadinessFacts(admin, orgId, row.id);
            if (!facts) return null;
            const readiness = evaluateReleaseReadiness(facts);
            return {
              row,
              gates: RELEASE_GATES.map((gate) => {
                const approvalGate = APPROVAL_GATE[gate];
                return {
                  gate,
                  blocked: readiness.gates[gate].blockers.length > 0,
                  approver: approvalGate ? (facts.approvals[approvalGate].current.pending?.approver_id ?? null) : null,
                };
              }),
            };
          } catch (err) {
            if (err instanceof ReleaseReadinessNotReadyError) {
              ready = false;
              return null;
            }
            throw err;
          }
        }),
      )),
    );
  }
  const done = evaluated.filter((e): e is NonNullable<typeof e> => e !== null);
  if (done.length === 0) return { ready, list: [] };

  const names = await labels(admin, orgId, done.flatMap((e) => [e.row.created_by, ...e.gates.map((g) => g.approver)]));
  const rosterById = new Map(roster.map((a) => [a.id, a]));
  const contactIds = [...new Set(done.map((e) => e.row.contact_id.toLowerCase()))];
  const unlisted = contactIds.filter((id) => !rosterById.has(id));
  const extra = new Map<string, string>();
  if (unlisted.length) {
    const res = await admin.from('contacts').select('id, name').eq('org_id', orgId).in('id', unlisted);
    if (res.error) throw new Error(`release artists: ${res.error.message}`);
    for (const c of (res.data ?? []) as { id: string; name: string | null }[]) extra.set(c.id.toLowerCase(), c.name ?? '');
  }
  return {
    ready,
    list: done.map(({ row, gates }): AttentionRelease => {
      const artist = row.contact_id.toLowerCase();
      return {
        id: row.id,
        title: row.title,
        artistIds: [artist],
        artistName: rosterById.get(artist)?.name ?? (extra.get(artist) || null),
        state: 'draft',
        targetDate: row.target_date,
        gates: gates.map((g) => ({ gate: g.gate, blocked: g.blocked, person: person(names, g.approver) })),
        owner: person(names, row.created_by),
      };
    }),
  };
}

// ── Tasks ───────────────────────────────────────────────────────────────

const TASK_COLUMNS = 'id, title, notes, due_at, done_at, assignee_id, created_by, artist_id, project_id, song_id, release_id, created_at';

async function readTasks(access: OrgAccessOk, now: Date): Promise<AttentionTask[]> {
  const { admin, orgId } = access;
  let rows;
  try {
    rows = await pageAll<Parameters<typeof toTaskRow>[0]>(
      (from, to) =>
        admin
          .from('tasks')
          .select(TASK_COLUMNS)
          .eq('org_id', orgId)
          .is('done_at', null)
          .not('due_at', 'is', null)
          .lt('due_at', now.toISOString())
          .order('due_at', { ascending: true })
          .order('id')
          .range(from, to),
      'task read',
    );
  } catch (err) {
    if (err instanceof ReadError && isMissingSchema(err.raw)) return [];
    throw err;
  }
  const visible = await visibleTasks(admin, access, rows.map(toTaskRow));
  if (visible.length === 0) return [];
  const names = await labels(admin, orgId, visible.flatMap((t) => [t.assigneeId, t.createdBy]));
  return visible.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt,
    assignee: person(names, t.assigneeId),
    creator: person(names, t.createdBy),
    target: t.target,
  }));
}

// ── Entry ───────────────────────────────────────────────────────────────

async function readSlug(admin: Admin, orgId: string): Promise<string> {
  const res = await admin.from('organizations').select('slug').eq('id', orgId).maybeSingle();
  if (res.error || !res.data) throw new Error(`org read: ${res.error?.message ?? 'not found'}`);
  return (res.data as { slug: string }).slug;
}

/** The member's Needs attention list: scope-filtered, D4-filtered, ordered. `slug` builds the links (read when the caller has not got it). */
export async function loadAttention(access: OrgAccessOk, slug: string | null = null, now: Date = new Date()): Promise<AttentionView> {
  const [orgSlug, settings] = await Promise.all([slug ?? readSlug(access.admin, access.orgId), readSettings(access.admin, access.orgId)]);
  const [roster, scoped] = await Promise.all([readRoster(access), orgProjectIdsInScope(access.admin, access)]);
  const [songs, releases, tasks] = await Promise.all([
    readSongs(access, roster, scoped, settings, now),
    readReleases(access, roster, scoped, settings, now),
    readTasks(access, now),
  ]);
  const input: AttentionInput = {
    orgSlug,
    now,
    settings,
    artistScope: access.artistScope === null ? null : new Set([...access.artistScope].map((id) => id.toLowerCase())),
    releases: releases.list,
    songs,
    tasks,
  };
  const { items, restricted } = computeAttention(input);
  return { items, restricted, releasesReady: releases.ready };
}
