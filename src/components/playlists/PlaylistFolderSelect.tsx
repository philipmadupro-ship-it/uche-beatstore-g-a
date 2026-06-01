'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plus, Check, X, FolderPlus } from 'lucide-react';
import { toast } from '@/hooks/useToast';

interface Folder { id: string; name: string; color?: string | null }

export function PlaylistFolderSelect({ playlistId, onClose, onSaved }: { playlistId: string; onClose: () => void; onSaved?: () => void }) {
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
        const [fRes, mRes] = await Promise.all([fetch('/api/playlists/folders'), fetch(`/api/playlists/${playlistId}/folders`)]);
        const fData = fRes.ok ? await fRes.json() : { folders: [] };
        const mData = mRes.ok ? await mRes.json() : { folder_ids: [] };
        if (!alive) return;
        setFolders(fData.folders ?? []);
        setSelected(new Set(mData.folder_ids ?? []));
      } catch {} finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [playlistId]);

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const createFolder = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/playlists/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setFolders((f) => [...f, data.folder]);
      setSelected((s) => new Set(s).add(data.folder.id));
      setNewName('');
    } catch (err) { toast.error("Couldn't create folder", err instanceof Error ? err.message : ''); }
    finally { setCreating(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/playlists/${playlistId}/folders`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_ids: [...selected] }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error); }
      toast.success('Folders updated'); onSaved?.(); onClose();
    } catch (err) { toast.error("Couldn't save folders", err instanceof Error ? err.message : ''); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-[#1f1a13] bg-[#0e0c08] shadow-2xl flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a160f]">
          <div className="flex items-center gap-2"><FolderPlus size={13} className="text-[#a08a6a]" /><h3 className="text-[12px] font-bold text-[#E8DCC8]">Move to folders</h3></div>
          <button onClick={onClose} className="text-[#5a5142] hover:text-white"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {loading ? <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-[#4a4338]" /></div>
            : folders.length === 0 ? <p className="text-[11px] text-[#5a5142] text-center py-6">No folders yet — create one below.</p>
            : folders.map((f) => {
              const on = selected.has(f.id);
              return (
                <button key={f.id} onClick={() => toggle(f.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${on ? 'bg-[#2A2418]' : 'hover:bg-[#14110d]'}`}>
                  <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${on ? 'bg-[#D4BFA0] border-[#E8D8B8]' : 'border-[#2d2620]'}`}>{on && <Check size={11} className="text-black" />}</span>
                  <span className="text-[12px] text-[#E8DCC8] truncate">{f.name}</span>
                  {f.color && <span className="w-3 h-3 rounded-full shrink-0 ml-auto" style={{ backgroundColor: f.color }} />}
                </button>
              );
            })}
        </div>
        <div className="px-3 py-3 border-t border-[#1a160f] flex items-center gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }} placeholder="New folder…"
            className="flex-1 min-w-0 bg-[#14110d] border border-[#1f1a13] rounded-lg px-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]" />
          <button onClick={createFolder} disabled={!newName.trim() || creating} className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg bg-[#14110d] border border-[#1f1a13] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] disabled:opacity-40 transition-colors">
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          </button>
        </div>
        <div className="px-5 py-3 border-t border-[#1a160f] flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8]">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-[#D4BFA0] text-black hover:bg-[#E8D8B8] disabled:opacity-40 transition-colors">
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}Save
          </button>
        </div>
      </div>
    </div>
  );
}
