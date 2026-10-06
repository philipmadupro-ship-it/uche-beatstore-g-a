/**
 * PATCH / DELETE /api/org/[orgId]/tasks/[taskId] (LABEL-23).
 *
 *   PATCH { title?, notes?, due_at?, assignee_id?, done? }  omitted keeps, null
 *         clears; `done` ticks it off or reopens it. The maker, the assignee or
 *         an owner/admin who can SEE the task. Handing it to another member
 *         needs `tasks.write` and a member who can reach the task's object, and
 *         asks that member once (`task_assigned`).
 *   DELETE  the maker or an owner/admin (an assignee cannot make a task they
 *         were handed disappear).
 *
 * A task the caller may not see is 404, never 403: it is not theirs to know
 * exists. Authorisation is by membership first, so a non-member and an external
 * project member are refused before any task is read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody, isUUID } from '@/lib/validate';
import { OrgTaskPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent, type Verb } from '@/lib/labelos/activity';
import { notifyDirectAsk } from '@/lib/labelos/notify';
import { assigneeToNotify, mayChangeTask, mayDeleteTask, toTaskView } from '@/lib/labelos/tasks';
import { assigneeMayTake, deleteTask, readTask, taskEventSubject, taskPeople, updateTask, visibleTasks, type TaskColumns } from '@/lib/labelos/tasks-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tasks.item');

type Params = { params: Promise<{ orgId: string; taskId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, taskId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Tasks need Supabase.' });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  if (!isUUID(taskId)) return json(404, { error: 'Not found' });
  const parsed = await readBody(req, OrgTaskPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const viewer = { userId: access.userId, role: access.role };

  try {
    const found = await readTask(access.admin, access.orgId, taskId);
    const task = found ? (await visibleTasks(access.admin, access, [found]))[0] : undefined;
    if (!task) return json(404, { error: 'Not found' });
    if (!mayChangeTask(task, viewer)) return json(403, { error: 'Forbidden' });

    const columns: TaskColumns = {};
    if (body.title !== undefined) columns.title = body.title;
    if (body.notes !== undefined) columns.notes = body.notes;
    if (body.due_at !== undefined) columns.due_at = body.due_at;
    let reassigned = false;
    if (body.assignee_id !== undefined) {
      const next = body.assignee_id ? body.assignee_id.toLowerCase() : null;
      if ((next ?? null) !== (task.assigneeId?.toLowerCase() ?? null)) {
        // Handing a task to someone is creating work for them: it needs the ability the creator needs.
        if (!access.capabilities.has('tasks.write')) return json(403, { error: 'Forbidden' });
        if (next && !(await assigneeMayTake(access.admin, access.orgId, next, task.target))) {
          return json(400, { error: 'That member cannot be given this task' });
        }
        columns.assignee_id = next;
        reassigned = true;
      }
    }
    let completed = false;
    if (body.done !== undefined && body.done !== (task.doneAt !== null)) {
      columns.done_at = body.done ? new Date().toISOString() : null;
      columns.done_by = body.done ? access.userId : null;
      completed = body.done;
    }

    const updated = Object.keys(columns).length === 0 ? task : await updateTask(access.admin, access.orgId, taskId, columns);
    if (!updated) return json(404, { error: 'Not found' });

    if (updated !== task) {
      const verb: Verb = completed ? 'task.completed' : 'task.updated';
      await recordEvent(
        access.admin,
        { orgId: access.orgId, userId: access.userId },
        verb,
        await taskEventSubject(access.admin, access.orgId, updated),
        { reassigned, retitled: body.title !== undefined, reopened: body.done === false && columns.done_at === null },
      );
    }

    const names = await taskPeople(access.admin, access.orgId, [updated]);
    if (reassigned) {
      const ask = assigneeToNotify({ actorId: access.userId, before: task.assigneeId, after: updated.assigneeId });
      if (ask) {
        await notifyDirectAsk(access.admin, {
          kind: 'task_assigned',
          orgId: access.orgId,
          recipientId: ask,
          actorId: access.userId,
          actorName: names.get(access.userId) ?? null,
          subject: updated.title,
          data: { taskId: updated.id, target: updated.target ? { kind: updated.target.kind, id: updated.target.id } : null },
        });
      }
    }
    return json(200, { task: toTaskView(updated, names, viewer) });
  } catch (err) {
    log.error('task update failed', { orgId: access.orgId, taskId, error: errorMessage(err) });
    return json(500, { error: 'Could not update the task' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, taskId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Tasks need Supabase.' });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  if (!isUUID(taskId)) return json(404, { error: 'Not found' });
  const viewer = { userId: access.userId, role: access.role };

  try {
    const found = await readTask(access.admin, access.orgId, taskId);
    const task = found ? (await visibleTasks(access.admin, access, [found]))[0] : undefined;
    if (!task) return json(404, { error: 'Not found' });
    if (!mayDeleteTask(task, viewer)) return json(403, { error: 'Forbidden' });
    const subject = await taskEventSubject(access.admin, access.orgId, task);
    if (!(await deleteTask(access.admin, access.orgId, taskId))) return json(404, { error: 'Not found' });
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'task.deleted', subject, { object: task.target?.kind ?? null });
    return json(200, { ok: true });
  } catch (err) {
    log.error('task delete failed', { orgId: access.orgId, taskId, error: errorMessage(err) });
    return json(500, { error: 'Could not delete the task' });
  }
}
