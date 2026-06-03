'use client';

import { useState } from 'react';
import { X, Loader2, Tag, Layers } from 'lucide-react';
import { CRM_STAGES } from '@/lib/contracts';
import { STAGE_META } from './contacts-shared';
import { toast } from '@/hooks/useToast';

type Mode = 'stage' | 'addTags' | 'removeTags';

/**
 * Compact modal for batch operations on selected contacts. Opened from the
 * BatchActionBar (which can't host popovers). Stage → batch PATCH /api/contacts;
 * tags → POST /api/contacts/tags/bulk (merge / remove, never overwrite).
 */
export function BulkEditPanel({ mode, ids, onClose, onDone, tagsEndpoint = '/api/contacts/tags/bulk' }: { mode: Mode; ids: string[]; onClose: () => void; onDone: () => void; tagsEndpoint?: string }) {
  const [busy, setBusy] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const addToken = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((p) => [...p, t]);
    setTagInput('');
  };

  const applyStage = async (stage: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/contacts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, patch: { crm_status: stage } }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      toast.success(`Stage set on ${ids.length} contact${ids.length === 1 ? '' : 's'}`);
      onDone();
    } catch (err) { toast.error("Couldn't update stage", err instanceof Error ? err.message : ''); setBusy(false); }
  };

  const applyTags = async () => {
    if (tags.length === 0) return;
    setBusy(true);
    try {
      const body = mode === 'addTags' ? { ids, add: tags } : { ids, remove: tags };
      const res = await fetch(tagsEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      toast.success(`${mode === 'addTags' ? 'Added' : 'Removed'} ${tags.length} tag${tags.length === 1 ? '' : 's'} on ${ids.length} contact${ids.length === 1 ? '' : 's'}`);
      onDone();
    } catch (err) { toast.error("Couldn't update tags", err instanceof Error ? err.message : ''); setBusy(false); }
  };

  const title = mode === 'stage' ? 'Set stage' : mode === 'addTags' ? 'Add tags' : 'Remove tags';
  const Icon = mode === 'stage' ? Layers : Tag;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[#0e0c08] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2"><Icon size={13} className="text-[#a08a6a]" /><h3 className="text-[12px] font-semibold text-[var(--text-primary)]">{title} · {ids.length}</h3></div>
          <button onClick={onClose} className="text-[#5a5142] hover:text-white"><X size={14} /></button>
        </div>

        {mode === 'stage' ? (
          <div className="p-3 grid grid-cols-1 gap-1">
            {CRM_STAGES.map((s) => {
              const m = STAGE_META[s];
              return (
                <button key={s} disabled={busy} onClick={() => applyStage(s)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-[#16130e] transition-colors disabled:opacity-50 text-left">
                  <span className={`w-2 h-2 rounded-full ${m.dot}`} />
                  <span className={`text-[13px] font-medium ${m.text}`}>{m.label}</span>
                </button>
              );
            })}
            {busy && <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-[#5a5142]" /></div>}
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-[#2A2418] border border-[#8A7A5C]/40 text-[#E8D8B8]">
                  {t}
                  <button onClick={() => setTags((p) => p.filter((x) => x !== t))} className="text-[#6a5d4a] hover:text-red-400">×</button>
                </span>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addToken(); }}>
              <input autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Type a tag, Enter to add…"
                className="w-full bg-[#0a0907] border border-[var(--border)] rounded-lg px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder:text-[#3a3328] focus:outline-none focus:border-[var(--accent-dim)]" />
            </form>
            <button onClick={applyTags} disabled={busy || tags.length === 0}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-[12px] font-semibold bg-[var(--accent)] text-black hover:bg-[var(--accent-light)] disabled:opacity-40 transition-colors">
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              {mode === 'addTags' ? 'Add' : 'Remove'} on {ids.length} contact{ids.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
