/**
 * The browser's side of org tasks (LABEL-23): fetch them, make one, tick one,
 * remove one — each answering in words a toast can show. Pure of React.
 */
import type { TaskTarget, TaskView } from './tasks';

export type TasksResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function request<T>(url: string, init: RequestInit | undefined, failed: string, pick: (body: Record<string, unknown>) => T): Promise<TasksResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : failed };
    return { ok: true, ...pick(body) };
  } catch {
    return { ok: false, error: failed };
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** `?view=mine|asked`, or an object (`kind` + `id`). */
export type TaskQuery = { view: 'mine' | 'asked' } | { object: NonNullable<TaskTarget> };

export function taskQueryString(q: TaskQuery): string {
  return 'view' in q ? `view=${q.view}` : `kind=${q.object.kind}&id=${encodeURIComponent(q.object.id)}`;
}

export function fetchTasks(orgId: string, q: TaskQuery) {
  return request(`/api/org/${orgId}/tasks?${taskQueryString(q)}`, undefined, 'Could not load the tasks.', (b) => ({
    tasks: (Array.isArray(b.tasks) ? b.tasks : []) as TaskView[],
    canCreate: b.canCreate === true,
  }));
}

export function fetchAssignees(orgId: string, object: TaskTarget) {
  const qs = object ? `?kind=${object.kind}&id=${encodeURIComponent(object.id)}` : '';
  return request(`/api/org/${orgId}/tasks/assignees${qs}`, undefined, 'Could not load the members.', (b) => ({
    members: (Array.isArray(b.members) ? b.members : []) as { id: string; name: string }[],
  }));
}

export type NewTaskInput = { title: string; assigneeId?: string | null; dueAt?: string | null; target?: TaskTarget };

export function createTask(orgId: string, input: NewTaskInput) {
  return request(
    `/api/org/${orgId}/tasks`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: input.title, assignee_id: input.assigneeId ?? null, due_at: input.dueAt ?? null, target: input.target ?? null }),
    },
    'Could not create the task.',
    (b) => ({ task: b.task as TaskView }),
  );
}

export function setTaskDone(orgId: string, taskId: string, done: boolean) {
  return request(
    `/api/org/${orgId}/tasks/${taskId}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ done }) },
    'Could not update the task.',
    (b) => ({ task: b.task as TaskView }),
  );
}

export function removeTask(orgId: string, taskId: string) {
  return request(`/api/org/${orgId}/tasks/${taskId}`, { method: 'DELETE' }, 'Could not remove the task.', () => ({}));
}

/** A due date picked as a calendar day, as the instant that day ends at midday local (so it never slips a day across zones). */
export function dueAtFromDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
