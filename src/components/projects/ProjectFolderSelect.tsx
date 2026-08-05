'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Check, X, FolderPlus } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';

interface Folder { id: string; name: string }

/**
 * Modal to set which folders a project belongs to (mig 083 multi-membership).
 * Fetches the producer's folders + the project's current membership, lets them
 * toggle checkboxes and create new folders inline, then PUTs the final set.
 */
export function ProjectFolderSelect({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const panelRef = useDialogBehavior({ open: true, onClose });
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fRes, mRes] = await Promise.all([
          fetch('/api/projects/folders'),
          fetch(`/api/projects/${projectId}/folders`),
        ]);
        const fData = fRes.ok ? await fRes.json() : { folders: [] };
        const mData = mRes.ok ? await mRes.json() : { folder_ids: [] };
        if (!alive) return;
        setFolders(fData.folders ?? []);
        setSelected(new Set(mData.folder_ids ?? []));
      } catch {
        // best-effort
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const createFolder = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/projects/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFolders((f) => [...f, data.folder]);
      setSelected((s) => new Set(s).add(data.folder.id));
      setNewName('');
    } catch (err) {
      toast.error('Couldn’t create folder', err instanceof Error ? err.message : 'Try again');
    } finally {
      setCreating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_ids: [...selected] }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      toast.success('Folders updated');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error('Couldn’t save folders', err instanceof Error ? err.message : 'Try again');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Move to folders"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col max-h-[80vh] focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FolderPlus size={13} className="text-white/80" />
            <h3 className="text-[12px] font-bold text-white">Move to folders</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin text-white/40" /></div>
          ) : folders.length === 0 ? (
            <p className="text-[11px] text-white/40 text-center py-6">No folders yet — create one below.</p>
          ) : (
            folders.map((f) => {
              const on = selected.has(f.id);
              return (
                <button key={f.id} onClick={() => toggle(f.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${on ? 'bg-white/10' : 'hover:bg-white/[0.04]'}`}>
                  <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${on ? 'bg-white border-white/30' : 'border-white/20'}`}>
                    {on && <Check size={11} className="text-black" />}
                  </span>
                  <span className="text-[12px] text-white truncate">{f.name}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-3 py-3 border-t border-white/10 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }}
            placeholder="New folder…"
            className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
          />
          <button onClick={createFolder} disabled={!newName.trim() || creating}
            className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-[11px] font-medium text-white/80 hover:text-white hover:border-white/20 disabled:opacity-40 transition-colors">
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          </button>
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider text-white/60 hover:text-white transition-colors">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-white text-black hover:bg-white transition-colors disabled:opacity-40">
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}Save
          </button>
        </div>
      </div>
    </div>
  );
}
