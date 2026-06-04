'use client';

/**
 * FollowUpsPanel — compact "what's due" strip for the top of /contacts.
 * Shows overdue + due-today open tasks with a link to each contact. Hidden
 * entirely when nothing is due so it never adds noise.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { categorizeDue, dueLabel, DUE_META } from '@/lib/contacts/tasks';

interface DueTask {
  id: string;
  contact_id: string;
  contact_name: string;
  title: string;
  due_at: string | null;
}

export function FollowUpsPanel() {
  const [tasks, setTasks] = useState<DueTask[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/contacts/tasks')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.tasks) setTasks(d.tasks); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Only surface overdue + today — the actionable now.
  const due = tasks.filter((t) => {
    const b = categorizeDue(t.due_at);
    return b === 'overdue' || b === 'today';
  });

  if (!loaded || due.length === 0) return null;

  return (
    <div className="mb-5 rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1a160f]">
        <CalendarClock size={12} className="text-[#E8C86A]" />
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">
          {due.length} follow-up{due.length === 1 ? '' : 's'} due
        </span>
      </div>
      <ul className="divide-y divide-[#1a160f] max-h-[180px] overflow-y-auto">
        {due.map((t) => {
          const meta = DUE_META[categorizeDue(t.due_at)];
          return (
            <li key={t.id}>
              <Link
                href={`/contacts/${t.contact_id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#16130e] transition-colors group"
              >
                <span
                  className="shrink-0 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ color: meta.color, background: meta.bg }}
                >
                  {dueLabel(t.due_at)}
                </span>
                <span className="text-[12px] text-[#E8DCC8] truncate flex-1">{t.title}</span>
                <span className="text-[11px] text-[#6a5d4a] shrink-0 hidden sm:inline">{t.contact_name}</span>
                <ChevronRight size={12} className="text-[#3a3328] group-hover:text-[#6a5d4a] shrink-0 transition-colors" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
