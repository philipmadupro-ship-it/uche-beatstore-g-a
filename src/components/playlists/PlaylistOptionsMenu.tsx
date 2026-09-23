'use client';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast, confirmToast } from '@/hooks/useToast';
import { PlaylistFolderSelect } from './PlaylistFolderSelect';
import { PlaylistTagPicker } from './PlaylistTagPicker';
import { uploadImageFile } from '@/lib/upload/image-upload-client';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';

interface PlaylistLite { id: string; name: string; pinned?: boolean; cover_url?: string | null }

/**
 * Per-playlist ⋯ menu. Same grouping rules as ProjectOptionsMenu — frequent
 * edits first, cover/sharing next, destructive last and separated — so the two
 * collection types do not teach different muscle memory for the same job.
 *
 * `onEditTitle` lets a host page that shows the name inline own the rename; the
 * menu no longer grows its own input for a field the page can already edit.
 */
export function PlaylistOptionsMenu({ playlist, onChanged, onDeleted, align = 'right', onEditTitle }: {
  playlist: PlaylistLite; onChanged?: () => void; onDeleted?: () => void; align?: 'left' | 'right';
  onEditTitle?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showFolders, setShowFolders] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isPinned = !!playlist.pinned;
  const tagsPanelRef = useDialogBehavior({ open: showTags, onClose: () => setShowTags(false) });

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      onChanged?.();
    } catch (err) { toast.error("Couldn't save", err instanceof Error ? err.message : ''); }
    finally { setBusy(null); }
  };

  const onCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy('cover');
    try {
      const coverUrl = await uploadImageFile(file);
      await patch({ cover_url: coverUrl }, 'cover');
      toast.success('Cover updated');
    } catch (err) { toast.error('Cover upload failed', err instanceof Error ? err.message : ''); setBusy(null); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  /** Clear the cover so the playlist falls back to the brand default again. */
  const removeCover = async () => {
    await patch({ cover_url: null }, 'cover');
    toast.success('Cover removed');
  };

  const handleDelete = async () => {
    const ok = await confirmToast(`Delete "${playlist.name}"?`, 'Tracks stay in your library.', { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    if (!ok) return; setBusy('delete');
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Playlist deleted');
      if (onDeleted) {
        onDeleted();
      } else {
        onChanged?.();
      }
    } catch (err) { toast.error("Couldn't delete", err instanceof Error ? err.message : ''); setBusy(null); }
  };

  const sections: MenuSection[] = [
    {
      id: 'edit',
      items: [
        {
          id: 'rename', label: 'Rename', shortcut: 'R', shortcutKey: 'r',
          hidden: !onEditTitle, onSelect: () => onEditTitle?.(),
        },
        { id: 'tags', label: 'Edit tags', shortcut: 'T', shortcutKey: 't', onSelect: () => setShowTags(true) },
      ],
    },
    {
      id: 'content',
      label: 'Content',
      items: [
        {
          id: 'cover', label: 'Change cover', busy: busy === 'cover',
          onSelect: () => { fileRef.current?.click(); return 'keep-open' as const; },
        },
        {
          id: 'cover-remove', label: 'Remove cover', busy: busy === 'cover',
          hidden: !playlist.cover_url, onSelect: removeCover,
        },
      ],
    },
    {
      id: 'playlist',
      label: 'Playlist',
      items: [
        {
          id: 'pin', label: isPinned ? 'Unpin' : 'Pin to top', checked: isPinned, busy: busy === 'pin',
          onSelect: async () => { await patch({ pinned: !isPinned }, 'pin'); toast.success(isPinned ? 'Unpinned' : 'Pinned to top'); },
        },
        { id: 'folders', label: 'Move to folders…', onSelect: () => setShowFolders(true) },
      ],
    },
    {
      id: 'danger', danger: true,
      items: [{ id: 'delete', label: 'Delete playlist', busy: busy === 'delete', onSelect: handleDelete }],
    },
  ];

  return (
    <>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onCoverFile} />
      <ActionMenu
        sections={sections}
        align={align}
        label="Playlist options"
        busy={!!busy}
        triggerClassName="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/60 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
      />
      {showFolders && createPortal(<PlaylistFolderSelect playlistId={playlist.id} onClose={() => setShowFolders(false)} onSaved={onChanged} />, document.body)}
      {showTags && createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowTags(false)}>
          <div
            ref={tagsPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Edit tags"
            tabIndex={-1}
            className="focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <PlaylistTagPicker playlistId={playlist.id} />
          </div>
        </div>, document.body,
      )}
    </>
  );
}
