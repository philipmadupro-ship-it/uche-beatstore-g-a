'use client';

/**
 * Tasks inline on an object (LABEL-23, 07 §2.3): the song, a release, … — the
 * tasks THIS member made or was handed there (an owner/admin sees all), a
 * checkbox to tick one off, and a one-line form to add one. Inline, not a
 * generic project-management screen (07 §2.1): the form is a title, an
 * optional assignee and an optional day.
 *
 * The server decides everything this shows: what the member may see, who they
 * may hand a task to (only members who can reach the object), and whether they
 * may add one at all (`canCreate` = `tasks.write`; a roster artist has none and
 * sees no form).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { createTask, dueAtFromDay, fetchAssignees, fetchTasks, removeTask, setTaskDone } from '@/lib/labelos/tasks-client';
import { sortTasks, type TaskTarget, type TaskView } from '@/lib/labelos/tasks';
import { DUE_META, categorizeDue, dueLabel } from '@/lib/contacts/tasks';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const FIELD = 'h-8 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white disabled:opacity-40';

export function TaskRowView({ task, onToggle, onRemove, href, hrefLabel }: { task: TaskView; onToggle: (t: TaskView) => void; onRemove?: (t: TaskView) => void; href?: string | null; hrefLabel?: string }) {
  const done = task.doneAt !== null;
  const due = task.dueAt && !done ? DUE_META[categorizeDue(task.dueAt)] : null;
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid={`task-${task.id}`} data-done={done ? 'true' : 'false'}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? 'Reopen' : 'Complete'} “${task.title}”`}
        disabled={!task.canChange}
        onClick={() => onToggle(task)}
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40 ${done ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/20 hover:border-white/40'}`}
      >
        {done && <Check size={11} aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] leading-snug ${done ? 'text-white/40 line-through' : 'text-white/80'}`}>{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-white/40">
          {task.assignee && <span>{task.mine ? 'You' : task.assignee.name}</span>}
          {!task.assignee && <span>Unassigned</span>}
          {task.createdBy && !task.mine && task.createdBy.id !== task.assignee?.id && <span>from {task.createdBy.name}</span>}
          {due && task.dueAt && <span style={{ color: due.color }}>{dueLabel(task.dueAt)}</span>}
          {href && <a href={href} className="text-white/50 underline-offset-2 hover:text-white hover:underline">{hrefLabel ?? 'Open'}</a>}
        </p>
      </div>
      {onRemove && task.canDelete && (
        <button type="button" aria-label={`Remove “${task.title}”`} onClick={() => onRemove(task)} className="mt-0.5 shrink-0 text-white/30 transition-colors hover:text-white">
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function TasksPanel({ orgId, object: objectProp, label = 'Tasks', testId = 'tasks-panel' }: { orgId: string; object: NonNullable<TaskTarget>; label?: string; testId?: string }) {
  // A fresh literal from the parent each render must not re-run the load.
  const object = useMemo(() => ({ kind: objectProp.kind, id: objectProp.id }), [objectProp.kind, objectProp.id]);
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [day, setDay] = useState('');
  const [members, setMembers] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchTasks(orgId, { object });
    if (!res.ok) {
      setError(res.error);
      setTasks([]);
      return;
    }
    setError(null);
    setTasks(res.tasks);
    setCanCreate(res.canCreate);
  }, [orgId, object]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, as the sibling panels do
    void load();
  }, [load]);

  const openForm = async () => {
    setAdding(true);
    if (members === null) {
      const res = await fetchAssignees(orgId, object);
      setMembers(res.ok ? res.members : []);
    }
  };

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const res = await createTask(orgId, { title: t, assigneeId: assignee || null, dueAt: day ? dueAtFromDay(day) : null, target: object });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setTasks((cur) => sortTasks([res.task, ...(cur ?? [])]));
    setTitle('');
    setAssignee('');
    setDay('');
    setAdding(false);
  };

  const toggle = async (task: TaskView) => {
    const res = await setTaskDone(orgId, task.id, task.doneAt === null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setTasks((cur) => sortTasks((cur ?? []).map((x) => (x.id === task.id ? res.task : x))));
  };

  const remove = async (task: TaskView) => {
    const res = await removeTask(orgId, task.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setTasks((cur) => (cur ?? []).filter((x) => x.id !== task.id));
  };

  const open = (tasks ?? []).filter((t) => t.doneAt === null).length;
  // Nothing to show and nothing to add (a roster artist, an org member with no tasks here): no empty box.
  if (tasks !== null && tasks.length === 0 && !canCreate && !error) return null;
  return (
    <section aria-label={label} data-testid={testId}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className={LABEL}>{label}{tasks && tasks.length > 0 ? <span className="ml-1.5 text-white/30">{open}</span> : null}</h2>
        {canCreate && !adding && (
          <button type="button" onClick={() => void openForm()} className="inline-flex items-center gap-1 text-[10px] text-white/50 transition-colors hover:text-white" data-testid={`${testId}-add`}>
            <Plus size={12} aria-hidden="true" /> Add task
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-white/50" role="status">{error}</p>}
      {tasks && tasks.length === 0 && !error && !adding && <p className="text-[11px] text-white/40">No tasks here.</p>}
      {tasks && tasks.length > 0 && (
        <ul className="divide-y divide-white/[0.06]">
          {tasks.map((t) => <TaskRowView key={t.id} task={t} onToggle={toggle} onRemove={remove} />)}
        </ul>
      )}

      {adding && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          data-testid={`${testId}-form`}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }}
            maxLength={200}
            placeholder="What needs doing?"
            aria-label="Task"
            className={`${FIELD} min-w-[12rem] flex-1`}
          />
          <Dropdown<string>
            value={assignee}
            placeholder="Unassigned"
            aria-label="Assign to"
            options={[{ value: '', label: 'Unassigned' }, ...(members ?? []).map((m) => ({ value: m.id, label: m.name }))]}
            onChange={setAssignee}
          />
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Due date" className={FIELD} />
          <button type="submit" disabled={!title.trim() || busy} className={BTN}>Add</button>
          <button type="button" onClick={() => setAdding(false)} className="text-[11px] text-white/40 transition-colors hover:text-white">Cancel</button>
        </form>
      )}
    </section>
  );
}
