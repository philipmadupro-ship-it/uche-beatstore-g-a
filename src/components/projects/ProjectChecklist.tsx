'use client';

import { useCallback, useState } from 'react';
import { Check, Plus, Trash2, Loader2, ClipboardList } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { nanoid } from 'nanoid';

export interface ChecklistItem { id: string; label: string; done: boolean }

interface Props {
  projectId: string;
  items: ChecklistItem[];
  onChanged: (items: ChecklistItem[]) => void;
}

/**
 * Production completion checklist on the project detail. Items are stored as
 * jsonb on projects.checklist (mig 084). Optimistic toggle + add + delete;
 * each mutation patches the project via PATCH /api/projects/[id].
 */
export function ProjectChecklist({ projectId, items, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const patch = useCallback(async (next: ChecklistItem[]) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged(next);
    } catch (err) {
      toast.error("Couldn't save checklist", err instanceof Error ? err.message : 'Try again');
    } finally { setSaving(false); }
  }, [projectId, onChanged]);

  const toggle = (id: string) => {
    const next = items.map((it) => it.id === id ? { ...it, done: !it.done } : it);
    onChanged(next); // optimistic
    patch(next);
  };

  const addItem = async () => {
    const label = draft.trim();
    if (!label) return;
    const next = [...items, { id: nanoid(8), label, done: false }];
    setDraft('');
    setAdding(false);
    await patch(next);
  };

  const remove = (id: string) => {
    const next = items.filter((it) => it.id !== id);
    patch(next);
  };

  const done = items.filter((it) => it.done).length;
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={13} className="text-white/80" />
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/80">Checklist</span>
          {items.length > 0 && (
            <span className="text-[9px] font-mono text-white/30">{done}/{items.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 size={11} className="animate-spin text-white/40" />}
          {/* Progress pill */}
          {items.length > 0 && (
            <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${pct === 100 ? 'bg-[#6DC6A4]/15 text-[#6DC6A4]' : 'bg-white/[0.05] text-white/40'}`}>
              {pct}%
            </span>
          )}
          <button onClick={() => setAdding((v) => !v)}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/10 transition-colors">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="h-1 rounded-full bg-white/[0.05] mb-3 overflow-hidden">
          <div className="h-full rounded-full bg-[#6DC6A4] transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}

      {items.length === 0 && !adding && (
        <p className="text-[10px] text-white/40 leading-relaxed">
          Track your production milestones — cover art, mix, mastering, upload, promotion…
        </p>
      )}

      {adding && (
        <div className="flex items-center gap-2 mb-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
            placeholder="Checklist item…"
            className="flex-1 bg-white/[0.02] border border-white/10 rounded-md px-3 py-1.5 text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
          />
          <button onClick={addItem} disabled={!draft.trim()}
            className="px-3 py-1.5 rounded-md bg-white text-black text-[11px] font-bold hover:bg-white disabled:opacity-40">Add</button>
        </div>
      )}

      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2.5 py-1 group">
            <button onClick={() => toggle(it.id)}
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                it.done ? 'bg-[#6DC6A4] border-[#6DC6A4]' : 'border-white/20 hover:border-white/'
              }`}>
              {it.done && <Check size={10} className="text-black" />}
            </button>
            <span className={`text-[12px] flex-1 ${it.done ? 'line-through text-white/40' : 'text-white'}`}>{it.label}</span>
            <button onClick={() => remove(it.id)}
              className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition-all">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
