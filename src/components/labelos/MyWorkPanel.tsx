'use client';

/**
 * "My work" on the org Overview (LABEL-23, 07 §2.1): what is assigned to ME,
 * overdue first, then today, upcoming and undated, each with a link to the
 * song / artist / project it is about; and "Waiting on others", the tasks I
 * handed to somebody else. Not a project-management board: one list, ticked
 * off in place. It renders nothing until it knows there is something, so an
 * org with no tasks keeps the Overview exactly as it was.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/hooks/useToast';
import { fetchTasks, setTaskDone } from '@/lib/labelos/tasks-client';
import { groupOpenTasks, targetHref, type TaskView } from '@/lib/labelos/tasks';
import { TaskRowView } from './TasksPanel';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';

const HREF_LABEL = { artist: 'Artist', project: 'Project', song: 'Song', release: 'Release' } as const;

export function MyWorkPanel({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const [mine, setMine] = useState<TaskView[] | null>(null);
  const [asked, setAsked] = useState<TaskView[]>([]);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetchTasks(orgId, { view: 'mine' }), fetchTasks(orgId, { view: 'asked' })]);
    setMine(a.ok ? a.tasks : []);
    setAsked(b.ok ? b.tasks : []);
  }, [orgId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const toggle = async (task: TaskView) => {
    const res = await setTaskDone(orgId, task.id, task.doneAt === null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // A finished task leaves "My work" (it is open work only) and "Waiting on others".
    setMine((cur) => (cur ?? []).filter((x) => x.id !== task.id));
    setAsked((cur) => cur.filter((x) => x.id !== task.id));
  };

  const groups = useMemo(() => groupOpenTasks(mine ?? []), [mine]);
  if (mine === null || (mine.length === 0 && asked.length === 0)) return null;

  const hrefFor = (t: TaskView) => targetHref(orgSlug, t.target);
  return (
    <section aria-label="My work" className="mb-8 rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid="my-work">
      <h2 className={`${LABEL} mb-1`}>My work <span className="ml-1.5 text-white/30" data-testid="my-work-count">{mine.length}</span></h2>
      {mine.length === 0 && <p className="py-2 text-[11px] text-white/40">Nothing is assigned to you.</p>}
      {groups.map((g) => (
        <div key={g.bucket} data-testid={`my-work-${g.bucket}`}>
          <p className="mt-3 text-[10px] text-white/40">{g.label}</p>
          <ul className="divide-y divide-white/[0.06]">
            {g.tasks.map((t) => (
              <TaskRowView key={t.id} task={t} onToggle={toggle} href={hrefFor(t)} hrefLabel={t.target ? HREF_LABEL[t.target.kind] : undefined} />
            ))}
          </ul>
        </div>
      ))}
      {asked.length > 0 && (
        <div className="mt-5 border-t border-white/[0.06] pt-4" data-testid="waiting-on-others">
          <h3 className={`${LABEL} mb-1`}>Waiting on others <span className="ml-1.5 text-white/30">{asked.length}</span></h3>
          <ul className="divide-y divide-white/[0.06]">
            {asked.map((t) => (
              <TaskRowView key={t.id} task={t} onToggle={toggle} href={hrefFor(t)} hrefLabel={t.target ? HREF_LABEL[t.target.kind] : undefined} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
