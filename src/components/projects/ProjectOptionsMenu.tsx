'use client';

import { useRef, useState } from 'react';
import {
  MoreHorizontal, Image as ImageIcon, Pencil, FolderInput, Store,
  Trash2, Loader2, Check, CircleDot,
} from 'lucide-react';
import { toast, confirmToast } from '@/hooks/useToast';
import { ProjectFolderSelect } from './ProjectFolderSelect';

interface ProjectLite {
  id: string;
  name: string;
  status?: string | null;
  store_featured?: boolean;
  cover_url?: string | null;
}

const STATUSES: { value: 'in_progress' | 'final' | 'archived'; label: string }[] = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'final', label: 'Final' },
  { value: 'archived', label: 'Archived' },
];

/**
 * Per-project options (⋯). Used on the list card and the detail header.
 * Change cover (upload → PATCH cover_url), Rename, Move to folders, Set status,
 * Add/remove from store, Delete. All actions PATCH/DELETE /api/projects/[id]
 * then call onChanged() so the parent refetches.
 */
export function ProjectOptionsMenu({
  project,
  onChanged,
  onDeleted,
  align = 'right',
}: {
  project: ProjectLite;
  onChanged?: () => void;
  onDeleted?: () => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [showFolders, setShowFolders] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      onChanged?.();
    } catch (err) {
      toast.error('Couldn’t save', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  const onCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('cover');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/upload/image', { method: 'POST', body: fd });
      const data = await up.json();
      if (!up.ok) throw new Error(data?.error || 'Upload failed');
      await patch({ cover_url: data.url }, 'cover');
      toast.success('Cover updated');
      setOpen(false);
    } catch (err) {
      toast.error('Cover upload failed', err instanceof Error ? err.message : 'Try again');
      setBusy(null);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submitRename = async () => {
    const n = nameDraft.trim();
    if (!n || n === project.name) { setRenaming(false); return; }
    await patch({ name: n }, 'name');
    toast.success('Renamed');
    setRenaming(false);
    setOpen(false);
  };

  const handleDelete = async () => {
    setOpen(false);
    const ok = await confirmToast(`Delete "${project.name}"?`,
      'Removes the project (its tracks stay in your library). Cannot be undone.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    if (!ok) return;
    setBusy('delete');
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Project deleted');
      onDeleted ? onDeleted() : onChanged?.();
    } catch (err) {
      toast.error('Couldn’t delete', err instanceof Error ? err.message : 'Try again');
      setBusy(null);
    }
  };

  const featured = !!project.store_featured;
  const curStatus = project.status || 'in_progress';

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onCoverFile} />
      <div className="relative">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); setNameDraft(project.name); setRenaming(false); }}
          aria-label="Project options"
          className="w-7 h-7 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-sm text-[#a08a6a] hover:text-white hover:bg-black/60 transition-colors"
        >
          {busy && !open ? <Loader2 size={13} className="animate-spin" /> : <MoreHorizontal size={14} />}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }} />
            <div
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} z-50 w-52 max-w-[calc(100vw-2rem)] bg-[#0e0c09] border border-[#1f1a13] rounded-xl shadow-2xl overflow-hidden py-1`}
            >
              {renaming ? (
                <div className="p-2">
                  <input
                    autoFocus value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false); }}
                    className="w-full bg-[#14110d] border border-[#1f1a13] rounded-md px-2.5 py-2 text-[12px] text-[#E8DCC8] focus:outline-none focus:border-[#2d2620]"
                  />
                  <div className="flex justify-end gap-1.5 mt-2">
                    <button onClick={() => setRenaming(false)} className="px-2 py-1 text-[10px] font-mono uppercase text-[#6a5d4a] hover:text-[#E8DCC8]">Cancel</button>
                    <button onClick={submitRename} className="px-2.5 py-1 text-[10px] font-mono uppercase rounded bg-[#D4BFA0] text-black hover:bg-[#E8D8B8]">Save</button>
                  </div>
                </div>
              ) : (
                <>
                  <MenuItem icon={<ImageIcon size={13} />} label="Change cover" busy={busy === 'cover'} onClick={() => fileRef.current?.click()} />
                  <MenuItem icon={<Pencil size={13} />} label="Rename" onClick={() => setRenaming(true)} />
                  <MenuItem icon={<FolderInput size={13} />} label="Move to folders" onClick={() => { setShowFolders(true); setOpen(false); }} />

                  <div className="my-1 border-t border-[#1a160f]" />
                  <p className="px-3 pt-1 pb-1 text-[8px] font-mono uppercase tracking-[0.2em] text-[#3a3328]">Status</p>
                  {STATUSES.map((s) => (
                    <MenuItem
                      key={s.value}
                      icon={curStatus === s.value ? <Check size={13} className="text-[#6DC6A4]" /> : <CircleDot size={13} className="opacity-40" />}
                      label={s.label}
                      busy={busy === `status-${s.value}`}
                      onClick={async () => { await patch({ status: s.value }, `status-${s.value}`); setOpen(false); }}
                    />
                  ))}

                  <div className="my-1 border-t border-[#1a160f]" />
                  <MenuItem
                    icon={<Store size={13} className={featured ? 'text-[#7F77DD]' : ''} />}
                    label={featured ? 'Remove from store' : 'Add to store'}
                    busy={busy === 'store'}
                    onClick={async () => {
                      await patch({ store_featured: !featured, ...(featured ? {} : { is_public: true }) }, 'store');
                      toast.success(featured ? 'Removed from store' : 'Added to store');
                      setOpen(false);
                    }}
                  />
                  <MenuItem icon={<Trash2 size={13} />} label="Delete" danger onClick={handleDelete} />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {showFolders && (
        <ProjectFolderSelect projectId={project.id} onClose={() => setShowFolders(false)} onSaved={onChanged} />
      )}
    </>
  );
}

function MenuItem({
  icon, label, onClick, danger, busy,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50 ${
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-[#E8DCC8] hover:bg-[#16130e]'
      }`}
    >
      <span className="shrink-0">{busy ? <Loader2 size={13} className="animate-spin" /> : icon}</span>
      {label}
    </button>
  );
}
