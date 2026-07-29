'use client';
import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, X, Plus, Pencil, Trash2, Check, Loader2, Folder } from 'lucide-react';
import { CONTENT_BUCKET_OPTIONS, TAG_TAXONOMY } from '@/lib/types/tags';
import { toast, confirmToast } from '@/hooks/useToast';
import { type PlaylistFilterState, type PlaylistSortMode, activePlaylistFilterCount } from '@/lib/playlists/filters';
import { Drawer } from '@/components/ui/Drawer';
import { Dropdown } from '@/components/ui/Dropdown';
import { FolderContainerCard } from '@/components/ui/ProductList';

interface FolderRow { id: string; name: string; color?: string | null; cover_urls?: string[] }

const SORTS: { value: PlaylistSortMode; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'tracks', label: 'Most tracks' },
];

export function PlaylistFilterBar({
  value, onChange, folders, onFoldersChanged, resultCount,
}: { value: PlaylistFilterState; onChange: (next: PlaylistFilterState) => void; folders: FolderRow[]; onFoldersChanged: () => void; resultCount: number }) {
  const [open, setOpen] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [manage, setManage] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const set = (patch: Partial<PlaylistFilterState>) => onChange({ ...value, ...patch });
  const activeCount = activePlaylistFilterCount(value);
  const selectedFolderLabel =
    value.folder === 'all'
      ? 'All playlists'
      : value.folder === 'unfiled'
        ? 'Unfiled'
        : folders.find((f) => f.id === value.folder)?.name ?? 'Folder';

  useEffect(() => {
    // Below lg, filters open as a bottom sheet instead of expanding the
    // page — tablets included, not just phones.
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const toggleTag = (tag: string) => {
    const n = new Set(value.tags);
    if (n.has(tag)) n.delete(tag);
    else n.add(tag);
    set({ tags: n });
  };

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

  const filterPanel = (
    <div className="space-y-4">
      {([['content', CONTENT_BUCKET_OPTIONS], ['genre', TAG_TAXONOMY.genre], ['mood', TAG_TAXONOMY.mood]] as [string, readonly string[]][]).map(([label, opts]) => (
        <div key={label}>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/50 mb-2">{label}</p>
          <div className="flex flex-wrap gap-1.5">
            {opts.map((tag) => {
              const active = value.tags.has(tag);
              return (
                <button key={tag} onClick={() => toggleTag(tag)} className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${active ? 'bg-white text-black border-white font-bold' : 'bg-white/[0.04] border-white/10 text-white/60 hover:text-white hover:border-white/20'}`}>
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {activeCount > 0 && (
        <button onClick={() => onChange({ ...value, search: '', folder: 'all', tags: new Set() })} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-white/60 hover:text-white transition-colors">
          <X size={11} /> Clear all
        </button>
      )}
    </div>
  );

  const folderPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FolderContainerCard label="All playlists" active={value.folder === 'all'} onClick={() => { set({ folder: 'all' }); setFolderMenuOpen(false); setFolderDrawerOpen(false); }} />
        <FolderContainerCard label="Unfiled" active={value.folder === 'unfiled'} onClick={() => { set({ folder: 'unfiled' }); setFolderMenuOpen(false); setFolderDrawerOpen(false); }} />
        {folders.map((f) => (
          <div key={f.id} className="relative">
            {editingId === f.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => renameFolder(f.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') renameFolder(f.id); if (e.key === 'Escape') setEditingId(null); }}
                className="h-10 w-full rounded-xl border border-white/30 bg-white/[0.04] px-3 text-[12px] text-white focus:outline-none"
              />
            ) : (
              <FolderContainerCard
                label={f.name}
                active={value.folder === f.id}
                color={f.color}
                covers={f.cover_urls}
                onClick={() => { set({ folder: f.id }); setFolderMenuOpen(false); setFolderDrawerOpen(false); }}
                actions={manage ? (
                  <>
                    <button onClick={() => { setEditingId(f.id); setEditName(f.name); }} className="w-7 h-7 rounded-full bg-black/45 flex items-center justify-center text-white/60 hover:text-white" aria-label="Rename folder"><Pencil size={11} /></button>
                    <button onClick={() => deleteFolder(f)} className="w-7 h-7 rounded-full bg-black/45 flex items-center justify-center text-white/60 hover:text-red-400" aria-label="Delete folder"><Trash2 size={11} /></button>
                  </>
                ) : undefined}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 pt-3">
        <input
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }}
          placeholder="New folder"
          className="min-h-10 flex-1 rounded-full border border-white/10 bg-white/[0.02] px-3 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
        />
        <button onClick={createFolder} disabled={!newFolder.trim() || busy} className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:border-white/20 disabled:opacity-40" aria-label="Create folder">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        </button>
        {folders.length > 0 && (
          <button onClick={() => setManage((v) => !v)} className={`grid size-10 shrink-0 place-items-center rounded-full transition-colors ${manage ? 'bg-white/15 text-white font-bold' : 'text-white/50 hover:text-white'}`} aria-label="Manage folders" title="Manage folders">
            {manage ? <Check size={12} /> : <Pencil size={12} />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="mb-5">
      {/* Search + Filters toggle + sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <button
            onClick={() => isMobile ? setFolderDrawerOpen(true) : setFolderMenuOpen((v) => !v)}
            className={`flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] font-medium transition-colors ${
              folderMenuOpen || folderDrawerOpen || value.folder !== 'all'
                ? 'bg-white/15 text-white border-white/40 font-bold'
                : 'bg-white/[0.04] border-white/10 text-white/60 hover:text-white hover:border-white/20'
            }`}
          >
            <Folder size={12} /> {selectedFolderLabel}
          </button>
          {folderMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFolderMenuOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-2 w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#0E0C09] p-3 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
                {folderPanel}
              </div>
            </>
          )}
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <input value={value.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search playlists + tags…"
            className="w-full bg-white/[0.02] border border-white/10 rounded-full py-2 pl-9 pr-3 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20" />
        </div>
        <button onClick={() => isMobile ? setMobileFilters(true) : setOpen((v) => !v)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-medium border transition-colors min-h-10 ${open || mobileFilters || activeCount > 0 ? 'bg-white/15 text-white border-white/40 font-bold' : 'bg-white/[0.04] border-white/10 text-white/60 hover:text-white hover:border-white/20'}`}>
          <SlidersHorizontal size={12} /> Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
        </button>
        <Dropdown
          value={value.sort}
          onChange={(v) => set({ sort: v as PlaylistSortMode })}
          options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
          aria-label="Sort playlists"
        />
        <span className="text-[10px] font-mono text-white/40 ml-auto hidden sm:inline">{resultCount} shown</span>
      </div>

      {/* Desktop (lg+) collapsible; below lg the bottom sheet takes over. */}
      {open && (
        <div className="mt-3 hidden rounded-xl border border-white/10 bg-white/[0.02] p-3 lg:block">
          {filterPanel}
        </div>
      )}
      <Drawer
        open={mobileFilters}
        onClose={() => setMobileFilters(false)}
        side="bottom"
        title="Playlist filters"
        description={`${resultCount} playlist${resultCount === 1 ? '' : 's'} shown`}
        contentClassName="pb-8"
      >
        {filterPanel}
      </Drawer>
      <Drawer
        open={folderDrawerOpen}
        onClose={() => setFolderDrawerOpen(false)}
        side="bottom"
        title="Playlist folders"
        description={selectedFolderLabel}
        contentClassName="pb-8"
      >
        {folderPanel}
      </Drawer>
    </div>
  );
}
