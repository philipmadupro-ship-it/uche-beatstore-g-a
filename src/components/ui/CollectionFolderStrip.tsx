'use client';

import { useState, type DragEvent } from 'react';
import { Folder, FolderPlus, Inbox, Layers, Loader2 } from 'lucide-react';

import { toast } from '@/hooks/useToast';
import { COLLECTION_DRAG_MIME, folderCounts, withFolder } from '@/lib/collections/folders';
import { cn } from '@/lib/utils';

/**
 * Always-visible folder rail for /projects and /playlists.
 *
 * Folders used to live only behind the filter bar's popover, and filing a
 * project meant ⋯ → Move to folders → tick → Save. Here every folder is on
 * screen with its count, one click filters, and dropping a card on a folder
 * files it there (added to its existing folders — membership is many-to-many).
 * Renaming and deleting stay in the filter bar's folder panel: one editor per
 * property.
 */
export type FolderFilter = 'all' | 'unfiled' | string;

interface FolderRow { id: string; name: string; color?: string | null }
interface Item { id: string; folder_ids?: string[] | null }

interface Props {
  resource: 'projects' | 'playlists';
  folders: FolderRow[];
  items: Item[];
  value: FolderFilter;
  onChange: (next: FolderFilter) => void;
  /** Refetch items + folders after a create or a file. */
  onChanged: () => void;
}

export function CollectionFolderStrip({ resource, folders, items, value, onChange, onChanged }: Props) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filing, setFiling] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const { byFolder, unfiled } = folderCounts(items);
  const noun = resource === 'projects' ? 'project' : 'playlist';

  const fileInto = async (itemId: string, folder: FolderRow) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if ((item.folder_ids ?? []).includes(folder.id)) {
      toast.info(`Already in ${folder.name}`);
      return;
    }
    setFiling(folder.id);
    try {
      const res = await fetch(`/api/${resource}/${itemId}/folders`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_ids: withFolder(item.folder_ids, folder.id) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Moved to ${folder.name}`);
      onChanged();
    } catch {
      toast.error(`Couldn’t file ${noun}`);
    } finally {
      setFiling(null);
    }
  };

  const create = async () => {
    const name = draft.trim();
    if (!name) { setCreating(false); return; }
    try {
      const res = await fetch(`/api/${resource}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft('');
      setCreating(false);
      onChanged();
    } catch {
      toast.error('Couldn’t create folder');
    }
  };

  const dropHandlers = (folder: FolderRow) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(COLLECTION_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropTarget(folder.id);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder.id ? null : t)),
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(COLLECTION_DRAG_MIME);
      setDropTarget(null);
      if (!id) return;
      e.preventDefault();
      void fileInto(id, folder);
    },
  });

  const chip = (active: boolean, dropping = false) => cn(
    'group inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[11px] transition-colors',
    dropping
      ? 'border-white/40 bg-white/[0.14] text-white'
      : active
        ? 'border-white/30 bg-white/[0.14] text-white'
        : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10] hover:text-white/90',
  );
  const count = (n: number) => (
    <span className="font-mono text-[10px] tabular-nums text-white/40">{n}</span>
  );

  return (
    <nav aria-label={`${noun} folders`} className="-mx-1 mb-4 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar">
      <button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')} className={chip(value === 'all')}>
        <Layers size={12} aria-hidden /> All {count(items.length)}
      </button>
      <button type="button" aria-pressed={value === 'unfiled'} onClick={() => onChange('unfiled')} className={chip(value === 'unfiled')}>
        <Inbox size={12} aria-hidden /> Unfiled {count(unfiled)}
      </button>
      {folders.length > 0 && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-white/10" />}
      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          aria-pressed={value === folder.id}
          onClick={() => onChange(value === folder.id ? 'all' : folder.id)}
          title={`Drop a ${noun} here to file it`}
          className={chip(value === folder.id, dropTarget === folder.id)}
          {...dropHandlers(folder)}
        >
          {filing === folder.id
            ? <Loader2 size={12} className="animate-spin" aria-hidden />
            : <Folder size={12} aria-hidden style={folder.color ? { color: folder.color } : undefined} />}
          <span className="max-w-[160px] truncate">{folder.name}</span>
          {count(byFolder.get(folder.id) ?? 0)}
        </button>
      ))}
      {creating ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
            if (e.key === 'Escape') { setDraft(''); setCreating(false); }
          }}
          onBlur={() => void create()}
          placeholder="Folder name"
          aria-label="New folder name"
          maxLength={80}
          className="h-9 w-40 shrink-0 rounded-lg border border-white/20 bg-white/[0.06] px-3 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
        >
          <FolderPlus size={12} aria-hidden /> New folder
        </button>
      )}
    </nav>
  );
}
