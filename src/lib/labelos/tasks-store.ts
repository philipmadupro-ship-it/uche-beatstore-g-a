/**
 * The reads and writes behind the task routes (LABEL-23). The rules are
 * `tasks.ts`; this file only touches the database. Service-role client, org
 * filter on every query: authorisation is the route's (`requireOrgMember`,
 * `requireOrgCapability`, `requireObjectAccess`), and a task is returned only
 * through `visibleTasks`, which applies both halves of "who may see it" — the
 * maker / assignee / owner-admin rule AND the member's artist scope — the TS
 * twin of migration 151's `tasks_member_read`.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isUUID } from '@/lib/validate';
import { objectAccessFor, liveMembership, orgProjectIdsInScope, type OrgContext } from '@/lib/auth/org-access';
import { scopeAllowsContact } from './artist-scope';
import type { Role } from './capabilities';
import type { EventSubject } from './activity';
import { memberIdentities, memberLabel, type IdentityAdmin } from './member-identity';
import { projectArtists } from './org-workspace-store';
import { memberMayReadSongRow, songEventSubject } from './song-stage-store';
import {
  canSeeTask,
  holdsEverything,
  sortTasks,
  targetColumns,
  targetOfRow,
  type TaskRow,
  type TaskTarget,
} from './tasks';

type TaskDbRow = {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  done_at: string | null;
  assignee_id: string | null;
  created_by: string | null;
  artist_id: string | null;
  project_id: string | null;
  song_id: string | null;
  release_id: string | null;
  created_at: string;
};

const COLUMNS = 'id, title, notes, due_at, done_at, assignee_id, created_by, artist_id, project_id, song_id, release_id, created_at';

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

export function toTaskRow(r: TaskDbRow): TaskRow {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueAt: r.due_at,
    doneAt: r.done_at,
    assigneeId: r.assignee_id,
    createdBy: r.created_by,
    target: targetOfRow(r),
    createdAt: r.created_at,
  };
}

/** One task of this org, or null. No visibility test: the caller applies `visibleTasks`. */
export async function readTask(admin: AdminClient, org: string, taskId: string): Promise<TaskRow | null> {
  const res = await admin.from('tasks').select(COLUMNS).eq('id', taskId).eq('org_id', org).maybeSingle();
  if (res.error) fail('task read', res.error);
  return res.data ? toTaskRow(res.data as TaskDbRow) : null;
}

// ── Visibility ──────────────────────────────────────────────────────────

/**
 * The artist-scope half of "may this member see the task": a task with no
 * object is nobody's scope to restrict; one on an artist needs that artist in
 * the member's scope; on a project, song or release it needs a project of the
 * member's scope (a song: one it sits in; a release: its own). The whole-org
 * member has no scope and passes everything.
 */
async function inScope(admin: AdminClient, ctx: OrgContext, tasks: readonly TaskRow[]): Promise<Set<string>> {
  if (ctx.artistScope === null) return new Set(tasks.map((t) => t.id));
  const projects = new Set((await orgProjectIdsInScope(admin, ctx)) ?? []);
  const songs = tasks.filter((t) => t.target?.kind === 'song').map((t) => t.target!.id);
  const releases = tasks.filter((t) => t.target?.kind === 'release').map((t) => t.target!.id);

  const songOk = new Set<string>();
  if (songs.length > 0 && projects.size > 0) {
    const res = await admin.from('project_tracks').select('project_id, track_id').in('track_id', [...new Set(songs)]);
    if (res.error) fail('song scope read', res.error);
    for (const l of (res.data ?? []) as { project_id: string; track_id: string }[]) {
      if (projects.has(l.project_id)) songOk.add(l.track_id.toLowerCase());
    }
  }
  const releaseOk = new Set<string>();
  if (releases.length > 0 && projects.size > 0) {
    const res = await admin.from('releases').select('id, project_id').in('id', [...new Set(releases)]).eq('org_id', ctx.orgId);
    if (res.error) fail('release scope read', res.error);
    for (const r of (res.data ?? []) as { id: string; project_id: string }[]) {
      if (projects.has(r.project_id)) releaseOk.add(r.id.toLowerCase());
    }
  }

  const ok = new Set<string>();
  for (const t of tasks) {
    const target = t.target;
    if (!target) ok.add(t.id);
    else if (target.kind === 'artist') {
      if (scopeAllowsContact(ctx.artistScope, target.id)) ok.add(t.id);
    } else if (target.kind === 'project') {
      if (projects.has(target.id)) ok.add(t.id);
    } else if (target.kind === 'song') {
      if (songOk.has(target.id)) ok.add(t.id);
    } else if (releaseOk.has(target.id)) ok.add(t.id);
  }
  return ok;
}

/** The tasks of `tasks` this member may see: maker / assignee / owner-admin, inside their artist scope. */
export async function visibleTasks(admin: AdminClient, ctx: OrgContext & { role: Role }, tasks: readonly TaskRow[]): Promise<TaskRow[]> {
  const mine = tasks.filter((t) => canSeeTask(t, { userId: ctx.userId, role: ctx.role }));
  if (mine.length === 0) return [];
  const ok = await inScope(admin, ctx, mine);
  return mine.filter((t) => ok.has(t.id));
}

// ── Lists ───────────────────────────────────────────────────────────────

export type TaskListView =
  /** Open tasks assigned to me ("My work"). */
  | { kind: 'mine'; includeDone?: boolean }
  /** Open tasks I handed to someone else ("Waiting on others"). */
  | { kind: 'asked' }
  /** Every task I may see on one object (inline on a song, a release…). */
  | { kind: 'object'; target: NonNullable<TaskTarget>; includeDone?: boolean };

const LIST_LIMIT = 200;

export async function listTasks(admin: AdminClient, ctx: OrgContext & { role: Role }, view: TaskListView): Promise<TaskRow[]> {
  let q = admin.from('tasks').select(COLUMNS).eq('org_id', ctx.orgId);
  const me = ctx.userId.toLowerCase();
  if (view.kind === 'mine') {
    q = q.eq('assignee_id', me);
    if (!view.includeDone) q = q.is('done_at', null);
  } else if (view.kind === 'asked') {
    q = q.eq('created_by', me).is('done_at', null);
  } else {
    const col = Object.entries(targetColumns(view.target)).find(([, v]) => v !== null)![0];
    q = q.eq(col, view.target.id);
    if (!view.includeDone) q = q.is('done_at', null);
    // Everyone but an owner/admin sees only their own side of the object's tasks (D1). The id is
    // interpolated into a PostgREST `or=` string, where a value with commas or dots would rewrite the filter.
    if (!holdsEverything(ctx.role)) {
      if (!isUUID(me)) throw new Error('task list: the caller is not a uuid');
      q = q.or(`assignee_id.eq.${me},created_by.eq.${me}`);
    }
  }
  const res = await q.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (res.error) fail('task list', res.error);
  let rows = ((res.data ?? []) as TaskDbRow[]).map(toTaskRow);
  // "Waiting on others" is the tasks I made for somebody else; a task I gave myself is in "My work".
  if (view.kind === 'asked') rows = rows.filter((t) => t.assigneeId !== null && t.assigneeId.toLowerCase() !== me);
  return sortTasks(await visibleTasks(admin, ctx, rows));
}

// ── Writes ──────────────────────────────────────────────────────────────

export type NewTask = {
  orgId: string;
  createdBy: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  assigneeId: string | null;
  target: TaskTarget;
};

export async function insertTask(admin: AdminClient, t: NewTask): Promise<TaskRow> {
  const res = await admin
    .from('tasks')
    .insert({
      org_id: t.orgId,
      title: t.title,
      notes: t.notes,
      due_at: t.dueAt,
      assignee_id: t.assigneeId,
      created_by: t.createdBy,
      ...targetColumns(t.target),
    })
    .select(COLUMNS)
    .single();
  if (res.error) fail('task write', res.error);
  return toTaskRow(res.data as TaskDbRow);
}

export type TaskColumns = Partial<{
  title: string;
  notes: string | null;
  due_at: string | null;
  assignee_id: string | null;
  done_at: string | null;
  done_by: string | null;
  updated_at: string;
}>;

export async function updateTask(admin: AdminClient, org: string, taskId: string, columns: TaskColumns): Promise<TaskRow | null> {
  const res = await admin.from('tasks').update({ ...columns, updated_at: new Date().toISOString() }).eq('id', taskId).eq('org_id', org).select(COLUMNS);
  if (res.error) fail('task write', res.error);
  const rows = (res.data ?? []) as TaskDbRow[];
  return rows[0] ? toTaskRow(rows[0]) : null;
}

export async function deleteTask(admin: AdminClient, org: string, taskId: string): Promise<boolean> {
  const res = await admin.from('tasks').delete().eq('id', taskId).eq('org_id', org).select('id');
  if (res.error) fail('task delete', res.error);
  return ((res.data as unknown[] | null) ?? []).length > 0;
}

// ── Assignees ───────────────────────────────────────────────────────────

const TARGET_TABLE = { artist: 'contacts', project: 'projects', song: 'tracks', release: 'releases' } as const;
export const TARGET_OBJECT_TABLE = TARGET_TABLE;

/**
 * May `userId` be handed a task on `target`? They must be a live member of the
 * org and, for a task on an object, reach that object exactly as they would
 * opening it (artist scope; a song's row under D4): a task must never tell a
 * member the name of something they cannot see. No reason is returned — the
 * caller says only "no".
 */
export async function assigneeMayTake(admin: AdminClient, orgId: string, userId: string, target: TaskTarget): Promise<boolean> {
  if (!target) return (await liveMembership(admin, orgId, userId)) !== null;
  const access = await objectAccessFor(userId, { table: TARGET_TABLE[target.kind], id: target.id, cap: 'catalog.read', orgId });
  if (!access.ok) return false;
  if (target.kind === 'song') return memberMayReadSongRow(admin, orgId, target.id, access.capabilities);
  return true;
}

/** The org's members (id + display name) who may be handed a task on `target`, name order. Bounded to the first 200 members: it runs only when the add-task form opens. */
export async function assignableMembers(admin: AdminClient, orgId: string, target: TaskTarget): Promise<{ id: string; name: string }[]> {
  const res = await admin.from('org_members').select('user_id').eq('org_id', orgId).limit(200);
  if (res.error) fail('member read', res.error);
  const ids = ((res.data ?? []) as { user_id: string }[]).map((m) => m.user_id);
  const allowed = (await Promise.all(ids.map(async (id) => ((await assigneeMayTake(admin, orgId, id, target)) ? id : null)))).filter((id): id is string => id !== null);
  const names = await memberIdentities(admin as unknown as IdentityAdmin, orgId, allowed, { withEmail: false });
  return allowed.map((id) => ({ id, name: memberLabel(names.get(id)) })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Display names for the people a set of tasks names (no emails). */
export async function taskPeople(admin: AdminClient, orgId: string, tasks: readonly TaskRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(tasks.flatMap((t) => [t.assigneeId, t.createdBy]).filter((x): x is string => !!x))];
  const names = await memberIdentities(admin as unknown as IdentityAdmin, orgId, ids, { withEmail: false });
  return new Map(ids.map((id) => [id, memberLabel(names.get(id))]));
}

/**
 * The name a notification gives the asker ("Sam assigned you a task"), or null
 * when they have none (the title then says "Someone"). Looked up only when an
 * ask is actually sent: the actor of a change is not always its maker or its
 * assignee (an owner reassigning), and most changes ask nobody.
 */
export async function askerName(admin: AdminClient, orgId: string, userId: string): Promise<string | null> {
  const names = await memberIdentities(admin as unknown as IdentityAdmin, orgId, [userId], { withEmail: false });
  return names.get(userId)?.name ?? null;
}

// ── Events ──────────────────────────────────────────────────────────────

/**
 * What a task event names: the task, and its object's artist / project / song
 * keys so a feed scoped to an artist or a project finds it (a task-only event
 * stays hidden from a scoped member until it names one). Best effort: the
 * change has already happened.
 */
export async function taskEventSubject(admin: AdminClient, org: string, task: Pick<TaskRow, 'id' | 'target'>): Promise<EventSubject> {
  const subject: EventSubject = { type: 'task', id: task.id.toLowerCase() };
  const target = task.target;
  if (!target) return subject;
  try {
    if (target.kind === 'artist') return { ...subject, artistId: target.id };
    if (target.kind === 'project') {
      const p = await admin.from('projects').select('id, inbox_for_contact_id').eq('id', target.id).eq('org_id', org).maybeSingle();
      const row = p.data as { id: string; inbox_for_contact_id: string | null } | null;
      const artists = row ? await projectArtists(admin, [row]) : null;
      return { ...subject, projectId: target.id, artistId: artists?.get(target.id)?.[0] ?? null };
    }
    if (target.kind === 'song') {
      const song = await songEventSubject(admin, org, target.id);
      return { ...song, type: 'task', id: task.id.toLowerCase() };
    }
    const r = await admin.from('releases').select('id, project_id, contact_id').eq('id', target.id).eq('org_id', org).maybeSingle();
    const row = r.data as { id: string; project_id: string | null; contact_id: string | null } | null;
    return { ...subject, releaseId: target.id, projectId: row?.project_id ?? null, artistId: row?.contact_id ?? null };
  } catch {
    return subject;
  }
}
