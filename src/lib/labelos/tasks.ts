/**
 * Org tasks (LABEL-23, 04 W5): the pure rules. Assignable follow-ups that
 * hang on at most ONE artist, project, song or release (migration 151's
 * `tasks_one_object` CHECK) or on nothing (an org-level task). The routes and
 * the UI import everything from here; `tasks-store.ts` only touches the
 * database. `contact_tasks` (095) is the producer's CRM follow-up, a separate
 * thing, and `lib/contacts/tasks.ts` keeps its due-date buckets, which this
 * module reuses rather than copying.
 *
 * Who sees a task (D1, "each side its own tasks"): the member who made it,
 * the member it is assigned to, and an owner or admin. Nobody else, whatever
 * else they can read of the object. The SQL twin is `tasks_member_read`.
 * Reaching the OBJECT is a separate test (artist scope, D4 for a song's row)
 * made by the store and the routes.
 */
import { isUUID } from '@/lib/validate';
import { categorizeDue, type DueBucket } from '@/lib/contacts/tasks';
import type { Capability, Role } from './capabilities';

export const TASK_TITLE_MAX = 200;
export const TASK_NOTES_MAX = 2000;

export const TASK_OBJECT_KINDS = ['artist', 'project', 'song', 'release'] as const;
export type TaskObjectKind = (typeof TASK_OBJECT_KINDS)[number];

/** What a task hangs on; null = the organization itself. */
export type TaskTarget = { kind: TaskObjectKind; id: string } | null;

/** The four typed foreign keys of the `tasks` row, exactly one of them set or none. */
export type TaskObjectColumns = {
  artist_id: string | null;
  project_id: string | null;
  song_id: string | null;
  release_id: string | null;
};

const COLUMN_OF: Record<TaskObjectKind, keyof TaskObjectColumns> = {
  artist: 'artist_id',
  project: 'project_id',
  song: 'song_id',
  release: 'release_id',
};

export function isTaskObjectKind(v: unknown): v is TaskObjectKind {
  return typeof v === 'string' && (TASK_OBJECT_KINDS as readonly string[]).includes(v);
}

/** The row columns for a target: the one key set (lower-cased uuid), the other three null. */
export function targetColumns(target: TaskTarget): TaskObjectColumns {
  const cols: TaskObjectColumns = { artist_id: null, project_id: null, song_id: null, release_id: null };
  if (target) cols[COLUMN_OF[target.kind]] = target.id.toLowerCase();
  return cols;
}

/**
 * A target from a row's columns. A row that (impossibly, under the CHECK)
 * names more than one object reads as no target at all rather than as one of
 * them: fail closed, never pick.
 */
export function targetOfRow(row: Partial<Record<keyof TaskObjectColumns, string | null>>): TaskTarget {
  const set = TASK_OBJECT_KINDS.filter((k) => typeof row[COLUMN_OF[k]] === 'string' && row[COLUMN_OF[k]]);
  if (set.length !== 1) return null;
  return { kind: set[0], id: String(row[COLUMN_OF[set[0]]]).toLowerCase() };
}

/** A target from loose input (a body, a query string), or `undefined` when it is malformed. null = none given. */
export function parseTarget(input: { kind?: unknown; id?: unknown } | null | undefined): TaskTarget | undefined {
  if (!input || (input.kind == null && input.id == null)) return null;
  if (!isTaskObjectKind(input.kind) || typeof input.id !== 'string' || !isUUID(input.id)) return undefined;
  return { kind: input.kind, id: input.id.toLowerCase() };
}

/** The capability that gates creating tasks (06 §2.3): every function column holds it. */
export const TASK_WRITE_CAP: Capability = 'tasks.write';

export function mayCreateTask(caps: ReadonlySet<string>): boolean {
  return caps.has(TASK_WRITE_CAP);
}

/** What the rules need to know about a task. */
export type TaskFacts = { assigneeId: string | null; createdBy: string | null };
export type TaskViewer = { userId: string; role: Role };

const sameUser = (a: string | null | undefined, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

/** An owner or admin of the org holds everything (06 §2.1). */
export function holdsEverything(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/** The TS twin of `tasks_member_read` minus the object-scope test. */
export function canSeeTask(task: TaskFacts, viewer: TaskViewer): boolean {
  return sameUser(task.assigneeId, viewer.userId) || sameUser(task.createdBy, viewer.userId) || holdsEverything(viewer.role);
}

/** Tick it off, retitle it, reassign it: its maker, its assignee, or an owner/admin who can see it. */
export function mayChangeTask(task: TaskFacts, viewer: TaskViewer): boolean {
  return canSeeTask(task, viewer);
}

/** Only the maker (or an owner/admin) deletes: an assignee cannot make a task they were handed disappear. */
export function mayDeleteTask(task: TaskFacts, viewer: TaskViewer): boolean {
  return sameUser(task.createdBy, viewer.userId) || holdsEverything(viewer.role);
}

/**
 * Whom a change notifies: the new assignee, once, and only if it is somebody
 * other than the person acting. A task made for yourself, a completed task,
 * an edit that keeps the assignee: nobody is asked for anything.
 */
export function assigneeToNotify(opts: { actorId: string; before: string | null | undefined; after: string | null | undefined }): string | null {
  const { actorId, before, after } = opts;
  if (!after || sameUser(after, actorId)) return null;
  if (before && before.toLowerCase() === after.toLowerCase()) return null;
  return after.toLowerCase();
}

// ── Listing ─────────────────────────────────────────────────────────────

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  doneAt: string | null;
  assigneeId: string | null;
  createdBy: string | null;
  target: TaskTarget;
  createdAt: string;
};

/** Open first, soonest due first (undated last), then newest; done tasks last, most recently done first. */
export function sortTasks<T extends Pick<TaskRow, 'dueAt' | 'doneAt' | 'createdAt' | 'id'>>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.doneAt !== null;
    const bDone = b.doneAt !== null;
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone && bDone) return String(b.doneAt).localeCompare(String(a.doneAt)) || a.id.localeCompare(b.id);
    if (a.dueAt !== b.dueAt) {
      if (a.dueAt === null) return 1;
      if (b.dueAt === null) return -1;
      return a.dueAt.localeCompare(b.dueAt);
    }
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

export type WorkGroup<T = TaskRow> = { bucket: DueBucket; label: string; tasks: T[] };

const GROUP_LABEL: Record<DueBucket, string> = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming', someday: 'No date' };
const GROUP_ORDER: DueBucket[] = ['overdue', 'today', 'upcoming', 'someday'];

/** "My work": the OPEN tasks grouped overdue → today → upcoming → no date. Empty groups are left out. */
export function groupOpenTasks<T extends Pick<TaskRow, 'dueAt' | 'doneAt' | 'createdAt' | 'id'>>(tasks: readonly T[], now: number = Date.now()): WorkGroup<T>[] {
  const buckets = new Map<DueBucket, T[]>();
  for (const t of sortTasks(tasks.filter((x) => x.doneAt === null))) {
    const b = categorizeDue(t.dueAt, now);
    buckets.set(b, [...(buckets.get(b) ?? []), t]);
  }
  return GROUP_ORDER.filter((b) => buckets.has(b)).map((b) => ({ bucket: b, label: GROUP_LABEL[b], tasks: buckets.get(b)! }));
}

/** The page a task's object lives on, for a link. The org slug is the shell's. */
export function targetHref(orgSlug: string, target: TaskTarget): string | null {
  if (!target) return null;
  const base = `/o/${encodeURIComponent(orgSlug)}`;
  switch (target.kind) {
    case 'artist': return `${base}/artists/${target.id}`;
    case 'project': return `${base}/projects/${target.id}`;
    case 'song': return `${base}/songs/${target.id}`;
    // A release has no page of its own yet (LABEL-16 is the artist workspace's Releases tab); its artist is not on the task.
    case 'release': return null;
  }
}

// ── The shape the API returns ───────────────────────────────────────────

export type TaskView = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  doneAt: string | null;
  /** A display name, never an email. */
  assignee: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  target: TaskTarget;
  createdAt: string;
  /** Assigned to the viewer. */
  mine: boolean;
  canChange: boolean;
  canDelete: boolean;
};

/** Built field by field: a row is never spread into the response. */
export function toTaskView(task: TaskRow, names: ReadonlyMap<string, string>, viewer: TaskViewer): TaskView {
  const person = (id: string | null) => (id ? { id, name: names.get(id) ?? 'Member' } : null);
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt,
    doneAt: task.doneAt,
    assignee: person(task.assigneeId),
    createdBy: person(task.createdBy),
    target: task.target,
    createdAt: task.createdAt,
    mine: sameUser(task.assigneeId, viewer.userId),
    canChange: mayChangeTask(task, viewer),
    canDelete: mayDeleteTask(task, viewer),
  };
}
