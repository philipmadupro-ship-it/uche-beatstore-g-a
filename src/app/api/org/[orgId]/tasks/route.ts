/**
 * /api/org/[orgId]/tasks — org tasks (LABEL-23, 04 W5).
 *
 *   GET  ?view=mine|asked            "My work" / "Waiting on others"
 *        ?kind=artist|project|song|release&id=<uuid>   the tasks on one object
 *        &done=1                     include finished tasks
 *        Any member. A member reads only their own side: tasks they made, tasks
 *        assigned to them, and — for an owner/admin — all of them (D1: each side
 *        its own tasks), and only inside their artist scope.
 *   POST { title, notes?, due_at?, assignee_id?, target? }
 *        `tasks.write` (every function column holds it). `target` is at most
 *        one of an artist, project, song or release the creator can reach; the
 *        assignee must be a member who can reach it too. Creating a task for
 *        someone else asks THEM, once (`task_assigned`); nobody else hears of it.
 *
 * Authorisation comes first and answers 403 / 404 whatever the body holds.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess, requireOrgCapability, requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgTaskCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { notifyDirectAsk } from '@/lib/labelos/notify';
import { memberMayReadSongRow, readStageSong } from '@/lib/labelos/song-stage-store';
import { assigneeToNotify, isTaskObjectKind, parseTarget, toTaskView, type TaskTarget } from '@/lib/labelos/tasks';
import { TARGET_OBJECT_TABLE, assigneeMayTake, insertTask, listTasks, taskEventSubject, taskPeople, type TaskListView } from '@/lib/labelos/tasks-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tasks');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Tasks need Supabase.' });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;

  const q = new URL(req.url).searchParams;
  const includeDone = q.get('done') === '1';
  let view: TaskListView;
  const viewName = q.get('view');
  if (viewName === 'mine') view = { kind: 'mine', includeDone };
  else if (viewName === 'asked') view = { kind: 'asked' };
  else if (isTaskObjectKind(q.get('kind'))) {
    const target = parseTarget({ kind: q.get('kind'), id: q.get('id') });
    if (!target) return json(400, { error: 'Name an object with kind and id' });
    view = { kind: 'object', target, includeDone };
  } else return json(400, { error: 'Ask for view=mine, view=asked, or an object (kind and id)' });

  try {
    const tasks = await listTasks(access.admin, access, view);
    const names = await taskPeople(access.admin, access.orgId, tasks);
    const viewer = { userId: access.userId, role: access.role };
    return json(200, { tasks: tasks.map((t) => toTaskView(t, names, viewer)), canCreate: access.capabilities.has('tasks.write') });
  } catch (err) {
    log.error('task list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the tasks' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Tasks need Supabase.' });
  const access = await requireOrgCapability(orgId, 'tasks.write');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgTaskCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const target: TaskTarget = body.target ? { kind: body.target.kind, id: body.target.id.toLowerCase() } : null;

  try {
    // The creator must reach the object themself, exactly as opening it would (scope, D4).
    if (target) {
      const obj = await requireObjectAccess({ table: TARGET_OBJECT_TABLE[target.kind], id: target.id, cap: 'catalog.read', orgId: access.orgId });
      if (!obj.ok) return obj.res;
      if (target.kind === 'song') {
        const song = await readStageSong(access.admin, access.orgId, target.id);
        if (!song || song.type !== 'song' || !(await memberMayReadSongRow(access.admin, access.orgId, target.id, obj.capabilities))) return json(404, { error: 'Not found' });
      }
    }
    const assigneeId = body.assignee_id ? body.assignee_id.toLowerCase() : null;
    if (assigneeId && !(await assigneeMayTake(access.admin, access.orgId, assigneeId, target))) {
      return json(400, { error: 'That member cannot be given this task' });
    }

    const task = await insertTask(access.admin, {
      orgId: access.orgId,
      createdBy: access.userId,
      title: body.title,
      notes: body.notes ?? null,
      dueAt: body.due_at ?? null,
      assigneeId,
      target,
    });

    // Everyday event, best effort: the task exists either way.
    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'task.created',
      await taskEventSubject(access.admin, access.orgId, task),
      { assigned: assigneeId !== null, due: task.dueAt !== null, object: target?.kind ?? null },
    );

    // Direct ask: only the assignee, only when it is somebody else.
    const ask = assigneeToNotify({ actorId: access.userId, before: null, after: assigneeId });
    const names = await taskPeople(access.admin, access.orgId, [task]);
    if (ask) {
      await notifyDirectAsk(access.admin, {
        kind: 'task_assigned',
        orgId: access.orgId,
        recipientId: ask,
        actorId: access.userId,
        actorName: names.get(access.userId) ?? null,
        subject: task.title,
        data: { taskId: task.id, target: target ? { kind: target.kind, id: target.id } : null },
      });
    }

    return json(201, { task: toTaskView(task, names, { userId: access.userId, role: access.role }) });
  } catch (err) {
    log.error('task create failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not create the task' });
  }
}
