'use client';

/**
 * ContactTasks — follow-up tasks / reminders for one contact.
 * Add a task (optional due date), check it off, delete it. Self-fetching.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, Check, Trash2, CalendarClock } from 'lucide-react';
import { categorizeDue, dueLabel, DUE_META } from '@/lib/contacts/tasks';

interface Task {
  id: string;
  title: string;
  due_at: string | null;
  done_at: string | null;
  created_at: string;
}

export function ContactTasks({ contactId }: { contactId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/tasks`);
      if (res.ok) setTasks((await res.json()).tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { void load(); }, [load]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, due_at: due ? new Date(due).toISOString() : null }),
      });
      if (res.ok) { setTitle(''); setDue(''); await load(); }
    } finally {
      setSaving(false);
    }
  }

  async function toggle(task: Task) {
    // optimistic
    setTasks((cur) => cur.map((x) => x.id === task.id ? { ...x, done_at: task.done_at ? null : new Date().toISOString() } : x));
    await fetch(`/api/contacts/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !task.done_at }),
    }).then(() => load()).catch(() => load());
  }

  async function remove(task: Task) {
    setTasks((cur) => cur.filter((x) => x.id !== task.id));
    await fetch(`/api/contacts/tasks/${task.id}`, { method: 'DELETE' }).catch(() => load());
  }

  const open = tasks.filter((t) => !t.done_at);
  const done = tasks.filter((t) => t.done_at);

  return (
    <section>
      <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-3 flex items-center gap-2">
        <CalendarClock size={11} /> Follow-ups{open.length > 0 ? ` · ${open.length}` : ''}
      </h2>

      <form onSubmit={addTask} className="flex flex-wrap gap-2 mb-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Follow up about…"
          className="flex-1 min-w-[160px] bg-white/[0.02] border border-[#1f1a13] rounded-lg px-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="bg-white/[0.02] border border-[#1f1a13] rounded-lg px-2.5 py-2 text-[12px] text-[#a08a6a] focus:outline-none focus:border-[#2d2620] [color-scheme:dark]"
        />
        <button
          type="submit"
          disabled={!title.trim() || saving}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-[11px] font-mono uppercase tracking-wider text-[#a08a6a] hover:text-[#E8DCC8] disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add
        </button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-6"><Loader2 size={14} className="animate-spin text-[#3a3328]" /></div>
      ) : tasks.length === 0 ? (
        <p className="text-[11px] text-[#5a5142] py-2">No follow-ups scheduled.</p>
      ) : (
        <ul className="space-y-1.5">
          {[...open, ...done].map((task) => {
            const bucket = categorizeDue(task.due_at);
            const meta = DUE_META[bucket];
            const isDone = !!task.done_at;
            return (
              <li key={task.id} className="flex items-center gap-2.5 group">
                <button
                  onClick={() => toggle(task)}
                  aria-label={isDone ? 'Mark not done' : 'Mark done'}
                  className={`shrink-0 w-4 h-4 rounded-[5px] border flex items-center justify-center transition-colors ${
                    isDone ? 'bg-[#6DC6A4] border-[#6DC6A4]' : 'border-[#2d2620] hover:border-[#6a5d4a]'
                  }`}
                >
                  {isDone && <Check size={11} className="text-black" strokeWidth={3} />}
                </button>
                <span className={`flex-1 text-[12px] leading-snug ${isDone ? 'text-[#5a5142] line-through' : 'text-[#E8DCC8]'}`}>
                  {task.title}
                </span>
                {!isDone && task.due_at && (
                  <span
                    className="shrink-0 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {dueLabel(task.due_at)}
                  </span>
                )}
                <button
                  onClick={() => remove(task)}
                  aria-label="Delete task"
                  className="shrink-0 text-[#3a3328] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-0.5"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
