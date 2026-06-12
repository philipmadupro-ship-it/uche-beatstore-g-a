'use client';

import { useState } from 'react';
import { Loader2, Tag, Layers } from 'lucide-react';
import { CRM_STAGES } from '@/lib/contracts';
import { STAGE_META } from './contacts-shared';
import { toast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

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
    <Modal
      onClose={onClose}
      title={`${title} · ${ids.length}`}
      description="Apply this batch update to the selected contacts."
      icon={<Icon size={16} aria-hidden="true" />}
      size="sm"
      contentClassName="p-0"
    >
        {mode === 'stage' ? (
          <div className="p-3 grid grid-cols-1 gap-1">
            {CRM_STAGES.map((s) => {
              const m = STAGE_META[s];
              return (
                <button key={s} disabled={busy} onClick={() => applyStage(s)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-[#1A1813] transition-colors disabled:opacity-50 text-left">
                  <span className={`w-2 h-2 rounded-full ${m.dot}`} />
                  <span className={`text-[13px] font-medium ${m.text}`}>{m.label}</span>
                </button>
              );
            })}
            {busy && <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-[#9B9282]" /></div>}
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-[#342F27] border border-[#C9BCA8]/40 text-[#F3E6D1]">
                  {t}
                  <button onClick={() => setTags((p) => p.filter((x) => x !== t))} className="text-[#B4AA99] hover:text-red-400">×</button>
                </span>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addToken(); }}>
              <Field
                autoFocus
                label="Tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Type a tag, Enter to add..."
                inputClassName="text-[12px] normal-case tracking-normal"
              />
            </form>
            <Button
              onClick={applyTags}
              disabled={tags.length === 0}
              loading={busy}
              variant="accent"
              className="w-full"
            >
              {mode === 'addTags' ? 'Add' : 'Remove'} on {ids.length} contact{ids.length === 1 ? '' : 's'}
            </Button>
          </div>
        )}
    </Modal>
  );
}
