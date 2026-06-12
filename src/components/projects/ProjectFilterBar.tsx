'use client';

import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, X, Plus, Pencil, Trash2, Check, Loader2, Folder } from 'lucide-react';
import { CONTENT_BUCKET_OPTIONS, TAG_TAXONOMY, PROJECT_TYPE_OPTIONS } from '@/lib/types/tags';
import { toast, confirmToast } from '@/hooks/useToast';
import { Drawer } from '@/components/ui/Drawer';
import { FolderContainerCard } from '@/components/ui/ProductList';
import {
  type ProjectFilterState,
  type ProjectSortMode,
  type ProjectStatusFilter,
  activeProjectFilterCount,
} from '@/lib/projects/filters';

interface FolderRow { id: string; name: string; color?: string | null; cover_urls?: string[] }

const STATUS_PILLS: { value: ProjectStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'final', label: 'Final' },
  { value: 'archived', label: 'Archived' },
];
const SORTS: { value: ProjectSortMode; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'tracks', label: 'Most tracks' },
];

/**
 * Projects list filter bar — folder chips (All / Unfiled / each, with inline
 * create + manage), search, and a collapsible panel for status, sort, and tag
 * chips (project-type + genre + mood). Mirrors the library FilterBar chip UX.
 * Folder chip row scrolls horizontally on mobile so it never wraps tall.
 */
export function ProjectFilterBar({
  value,
  onChange,
  folders,
  onFoldersChanged,
  resultCount,
}: {
  value: ProjectFilterState;
  onChange: (next: ProjectFilterState) => void;
  folders: FolderRow[];
  onFoldersChanged: () => void;
  resultCount: number;
}) {
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

  const set = (patch: Partial<ProjectFilterState>) => onChange({ ...value, ...patch });
  const activeCount = activeProjectFilterCount(value);
  const selectedFolderLabel =
    value.folder === 'all'
      ? 'All projects'
      : value.folder === 'unfiled'
        ? 'Unfiled'
        : folders.find((f) => f.id === value.folder)?.name ?? 'Folder';

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const toggleTag = (tag: string) => {
    const next = new Set(value.tags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    set({ tags: next });
  };

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/projects/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      setNewFolder('');
      onFoldersChanged();
    } catch (err) {
      toast.error('Couldn’t create folder', err instanceof Error ? err.message : 'Try again');
    } finally { setBusy(false); }
  };

  const renameFolder = async (id: string) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      const res = await fetch(`/api/projects/folders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onFoldersChanged();
    } catch { toast.error('Couldn’t rename folder'); }
  };

  const deleteFolder = async (f: FolderRow) => {
    const ok = await confirmToast(`Delete folder "${f.name}"?`, 'Projects inside stay; they just leave this folder.', { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/folders/${f.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (value.folder === f.id) set({ folder: 'all' });
      onFoldersChanged();
    } catch { toast.error('Couldn’t delete folder'); }
  };

  const filterPanel = (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_PILLS.map((s) => (
          <button key={s.value} onClick={() => set({ status: s.value })}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
              value.status === s.value ? 'bg-[#E7D7BE] text-black border-[#E7D7BE]' : 'bg-[#171511] border-[#2B2821] text-[#B4AA99] hover:text-[#D0C3AF] hover:border-[#3B372F]'
            }`}>{s.label}</button>
        ))}
      </div>

      {([['content', CONTENT_BUCKET_OPTIONS], ['project type', PROJECT_TYPE_OPTIONS], ['genre', TAG_TAXONOMY.genre], ['mood', TAG_TAXONOMY.mood]] as [string, readonly string[]][]).map(([label, opts]) => (
        <div key={label}>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">{label}</p>
          <div className="flex flex-wrap gap-1.5">
            {opts.map((tag) => {
              const active = value.tags.has(tag);
              return (
                <button key={tag} onClick={() => toggleTag(tag)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                    active ? 'bg-[#E7D7BE] text-black border-[#E7D7BE]' : 'bg-[#171511] border-[#2B2821] text-[#B4AA99] hover:text-[#D0C3AF] hover:border-[#3B372F]'
                  }`}>{tag}</button>
              );
            })}
          </div>
        </div>
      ))}

      {activeCount > 0 && (
        <button onClick={() => onChange({ ...value, search: '', status: 'all', folder: 'all', tags: new Set() })}
          className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#F7EBDD] transition-colors">
          <X size={11} /> Clear all
        </button>
      )}
    </div>
  );

  const folderPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FolderContainerCard label="All projects" active={value.folder === 'all'} onClick={() => { set({ folder: 'all' }); setFolderMenuOpen(false); setFolderDrawerOpen(false); }} />
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
                className="h-10 w-full rounded-xl border border-[#7F77DD]/50 bg-[#171511] px-3 text-[12px] text-[#F7EBDD] focus:outline-none"
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
                    <button onClick={() => { setEditingId(f.id); setEditName(f.name); }} className="w-7 h-7 rounded-full bg-black/45 flex items-center justify-center text-[#D0C3AF] hover:text-[#F7EBDD]" aria-label="Rename folder"><Pencil size={11} /></button>
                    <button onClick={() => deleteFolder(f)} className="w-7 h-7 rounded-full bg-black/45 flex items-center justify-center text-[#D0C3AF] hover:text-red-400" aria-label="Delete folder"><Trash2 size={11} /></button>
                  </>
                ) : undefined}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-[#211F1A] pt-3">
        <input
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }}
          placeholder="New folder"
          className="min-h-10 flex-1 rounded-full border border-[#2B2821] bg-[#11100D] px-3 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]"
        />
        <button onClick={createFolder} disabled={!newFolder.trim() || busy} className="grid size-10 shrink-0 place-items-center rounded-full border border-[#2B2821] bg-[#171511] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[#3B372F] disabled:opacity-40" aria-label="Create folder">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        </button>
        {folders.length > 0 && (
          <button onClick={() => setManage((v) => !v)} className={`grid size-10 shrink-0 place-items-center rounded-full transition-colors ${manage ? 'bg-[#342F27] text-[#F3E6D1]' : 'text-[#9B9282] hover:text-[#D0C3AF]'}`} aria-label="Manage folders" title="Manage folders">
            {manage ? <Check size={12} /> : <Pencil size={12} />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="mb-5">
      {/* Search + Filters toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <button
            onClick={() => isMobile ? setFolderDrawerOpen(true) : setFolderMenuOpen((v) => !v)}
            className={`flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] font-medium transition-colors ${
              folderMenuOpen || folderDrawerOpen || value.folder !== 'all'
                ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]/40'
                : 'bg-[#171511] border-[#2B2821] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[#3B372F]'
            }`}
          >
            <Folder size={12} /> {selectedFolderLabel}
          </button>
          {folderMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFolderMenuOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-2 w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#2B2821] bg-[#0E0C09] p-3 shadow-2xl">
                {folderPanel}
              </div>
            </>
          )}
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B] pointer-events-none" />
          <input
            value={value.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search projects + tags…"
            className="w-full bg-[#11100D] border border-[#2B2821] rounded-full py-2 pl-9 pr-3 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]"
          />
        </div>
        <button
          onClick={() => isMobile ? setMobileFilters(true) : setOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-medium border transition-colors min-h-10 ${
            open || mobileFilters || activeCount > 0 ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]/40' : 'bg-[#171511] border-[#2B2821] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[#3B372F]'
          }`}
        >
          <SlidersHorizontal size={12} /> Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
        </button>
        <select
          value={value.sort}
          onChange={(e) => set({ sort: e.target.value as ProjectSortMode })}
          className="px-3 py-2 rounded-full bg-[#171511] border border-[#2B2821] text-[11px] text-[#D0C3AF] focus:outline-none focus:border-[#3B372F] cursor-pointer"
        >
          {SORTS.map((s) => <option key={s.value} value={s.value} className="bg-[#090907]">{s.label}</option>)}
        </select>
        <span className="text-[10px] font-mono text-[#6E685B] ml-auto hidden sm:inline">{resultCount} shown</span>
      </div>

      {/* Desktop collapsible: mobile gets a contained bottom sheet. */}
      {open && (
        <div className="mt-3 hidden rounded-xl border border-[#2B2821] bg-[#11100D] p-3 sm:block">
          {filterPanel}
        </div>
      )}
      <Drawer
        open={mobileFilters}
        onClose={() => setMobileFilters(false)}
        side="bottom"
        title="Project filters"
        description={`${resultCount} project${resultCount === 1 ? '' : 's'} shown`}
        contentClassName="pb-8"
      >
        {filterPanel}
      </Drawer>
      <Drawer
        open={folderDrawerOpen}
        onClose={() => setFolderDrawerOpen(false)}
        side="bottom"
        title="Project folders"
        description={selectedFolderLabel}
        contentClassName="pb-8"
      >
        {folderPanel}
      </Drawer>
    </div>
  );
}
