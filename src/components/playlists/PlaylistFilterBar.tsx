'use client';
import { useState } from 'react';
import { Search, SlidersHorizontal, X, Plus, Pencil, Trash2, Check, Loader2, Folder } from 'lucide-react';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { toast, confirmToast } from '@/hooks/useToast';
import { type PlaylistFilterState, type PlaylistSortMode, activePlaylistFilterCount } from '@/lib/playlists/filters';

interface FolderRow { id: string; name: string; color?: string | null }

const SORTS: { value: PlaylistSortMode; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'tracks', label: 'Most tracks' },
];

export function PlaylistFilterBar({
  value, onChange, folders, onFoldersChanged, resultCount,
}: { value: PlaylistFilterState; onChange: (next: PlaylistFilterState) => void; folders: FolderRow[]; onFoldersChanged: () => void; resultCount: number }) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const set = (patch: Partial<PlaylistFilterState>) => onChange({ ...value, ...patch });
  const activeCount = activePlaylistFilterCount(value);

  const toggleTag = (tag: string) => { const n = new Set(value.tags); n.has(tag) ? n.delete(tag) : n.add(tag); set({ tags: n }); };

  const createFolder = async () => {
    const name = newFolder.trim(); if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/playlists/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      setNewFolder(''); onFoldersChanged();
    } catch (err) { toast.error("Couldn't create folder", err instanceof Error ? err.message : ''); }
    finally { setBusy(false); }
  };

  const renameFolder = async (id: string) => {
    const name = editName.trim(); setEditingId(null); if (!name) return;
    try { const res = await fetch(`/api/playlists/folders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); if (!res.ok) throw new Error(); onFoldersChanged(); }
    catch { toast.error("Couldn't rename folder"); }
  };

  const deleteFolder = async (f: FolderRow) => {
    const ok = await confirmToast(`Delete folder "${f.name}"?`, 'Playlists inside stay; they just leave this folder.', { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    if (!ok) return;
    try { const res = await fetch(`/api/playlists/folders/${f.id}`, { method: 'DELETE' }); if (!res.ok) throw new Error(); if (value.folder === f.id) set({ folder: 'all' }); onFoldersChanged(); }
    catch { toast.error("Couldn't delete folder"); }
  };

  const chip = (key: string, label: string, active: boolean, onClick: () => void, color?: string | null) => {
    const accent = color || '#7F77DD';
    return (
      <button key={key} onClick={onClick} className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors border ${active ? 'text-white' : 'bg-[#14110d] border-[#1f1a13] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620]'}`}
        style={active ? { backgroundColor: accent, borderColor: `${accent}66` } : {}}>
        {label}
      </button>
    );
  };

  return (
    <div className="mb-5">
      {/* Folder chips */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1 mb-3">
        <Folder size={12} className="text-[#3a3328] shrink-0" />
        {chip('all', 'All', value.folder === 'all', () => set({ folder: 'all' }))}
        {chip('unfiled', 'Unfiled', value.folder === 'unfiled', () => set({ folder: 'unfiled' }))}
        {folders.map((f) =>
          editingId === f.id ? (
            <input key={f.id} autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
              onBlur={() => renameFolder(f.id)} onKeyDown={(e) => { if (e.key === 'Enter') renameFolder(f.id); if (e.key === 'Escape') setEditingId(null); }}
              className="shrink-0 w-28 bg-[#14110d] border border-[#7F77DD]/50 rounded-full px-3 py-1.5 text-[12px] text-[#E8DCC8] focus:outline-none" />
          ) : (
            <span key={f.id} className="shrink-0 flex items-center">
              {chip(f.id, f.name, value.folder === f.id, () => set({ folder: f.id }), f.color)}
              {manage && (
                <span className="flex items-center -ml-1">
                  <button onClick={() => { setEditingId(f.id); setEditName(f.name); }} className="w-6 h-6 flex items-center justify-center text-[#6a5d4a] hover:text-[#E8DCC8]"><Pencil size={11} /></button>
                  <button onClick={() => deleteFolder(f)} className="w-6 h-6 flex items-center justify-center text-[#6a5d4a] hover:text-red-400"><Trash2 size={11} /></button>
                </span>
              )}
            </span>
          )
        )}
        <span className="shrink-0 flex items-center gap-1">
          <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }} placeholder="New folder"
            className="w-24 bg-[#0e0c08] border border-[#1f1a13] rounded-full px-3 py-1.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]" />
          <button onClick={createFolder} disabled={!newFolder.trim() || busy} className="w-7 h-7 shrink-0 rounded-full bg-[#14110d] border border-[#1f1a13] flex items-center justify-center text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] disabled:opacity-40">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          </button>
        </span>
        {folders.length > 0 && (
          <button onClick={() => setManage((v) => !v)} className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${manage ? 'bg-[#2A2418] text-[#E8D8B8]' : 'text-[#5a5142] hover:text-[#a08a6a]'}`} title="Manage folders">
            {manage ? <Check size={12} /> : <Pencil size={12} />}
          </button>
        )}
      </div>

      {/* Search + Filters toggle + sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328] pointer-events-none" />
          <input value={value.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search playlists + tags…"
            className="w-full bg-[#0e0c08] border border-[#1f1a13] rounded-full py-2 pl-9 pr-3 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]" />
        </div>
        <button onClick={() => setOpen((v) => !v)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-medium border transition-colors ${open || activeCount > 0 ? 'bg-[#2A2418] text-[#E8D8B8] border-[#8A7A5C]/40' : 'bg-[#14110d] border-[#1f1a13] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620]'}`}>
          <SlidersHorizontal size={12} /> Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
        </button>
        <select value={value.sort} onChange={(e) => set({ sort: e.target.value as PlaylistSortMode })}
          className="px-3 py-2 rounded-full bg-[#14110d] border border-[#1f1a13] text-[11px] text-[#a08a6a] focus:outline-none focus:border-[#2d2620] cursor-pointer">
          {SORTS.map((s) => <option key={s.value} value={s.value} className="bg-[#0a0907]">{s.label}</option>)}
        </select>
        <span className="text-[10px] font-mono text-[#3a3328] ml-auto hidden sm:inline">{resultCount} shown</span>
      </div>

      {open && (
        <div className="mt-3 rounded-xl border border-[#1f1a13] bg-[#0e0c08] p-3 space-y-3">
          {(['genre', 'mood'] as const).map((cat) => (
            <div key={cat}>
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">{cat}</p>
              <div className="flex flex-wrap gap-1.5">
                {TAG_TAXONOMY[cat].map((tag) => {
                  const active = value.tags.has(tag);
                  return (
                    <button key={tag} onClick={() => toggleTag(tag)} className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${active ? 'bg-[#D4BFA0] text-black border-[#D4BFA0]' : 'bg-[#14110d] border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a] hover:border-[#2d2620]'}`}>
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {activeCount > 0 && (
            <button onClick={() => onChange({ ...value, search: '', folder: 'all', tags: new Set() })} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
              <X size={11} /> Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
