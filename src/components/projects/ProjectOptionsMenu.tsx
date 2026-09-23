'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast, confirmToast } from '@/hooks/useToast';
import { ProjectFolderSelect } from './ProjectFolderSelect';
import { TemplatePicker } from './TemplatePicker';
import { uploadImageFile } from '@/lib/upload/image-upload-client';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';

interface ProjectLite {
  id: string;
  name: string;
  status?: string | null;
  store_featured?: boolean;
  cover_url?: string | null;
  description?: string | null;
  bpm_target?: number | null;
  key_target?: string | null;
  pinned?: boolean;
}

type ProjectStatus = 'in_progress' | 'final' | 'archived';

const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'final', label: 'Final' },
  { value: 'archived', label: 'Archived' },
];

interface Props {
  project: ProjectLite;
  onChanged?: () => void;
  onDeleted?: () => void;
  align?: 'left' | 'right';
  /** Number of tracks — only used to describe what Duplicate will copy. */
  trackCount?: number;
  /** When the host page can edit a property in place, the menu delegates to it
   *  instead of duplicating the editor. Absent = the item is hidden, which is
   *  what happens on the project grid where there is nothing to edit inline. */
  onEditTitle?: () => void;
  onEditTags?: () => void;
  onEditDescription?: () => void;
  onEditCover?: () => void;
  onSetStatus?: (s: ProjectStatus) => void;
}

/**
 * Per-project ⋯ menu, grouped by how often a producer reaches for each thing.
 *
 * Two rules decide the shape:
 *
 *  1. Frequency first. Title / tags / description / status sit at the top,
 *     because those are the daily edits. Folders and templates are further
 *     down because they are setup, not routine.
 *  2. Never own an editor the page can already show inline. On the project
 *     detail page these items just focus the field that is already on screen
 *     (`onEditTitle` etc.), so there is exactly one rename UI and it is the one
 *     the user can also just click. The menu used to grow its own rename input
 *     that replaced the whole menu body — a second editor for the same
 *     property, reachable only through the menu.
 *
 * On the grid card, where no inline editors exist, those props are omitted and
 * the items hide themselves rather than degrading into a worse editor.
 */
export function ProjectOptionsMenu({
  project,
  onChanged,
  onDeleted,
  align = 'right',
  trackCount,
  onEditTitle,
  onEditTags,
  onEditDescription,
  onEditCover,
  onSetStatus,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showFolders, setShowFolders] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`); }
      onChanged?.();
      return true;
    } catch (err) {
      toast.error('Couldn’t save', err instanceof Error ? err.message : 'Try again');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('cover');
    try {
      const coverUrl = await uploadImageFile(file);
      await patch({ cover_url: coverUrl }, 'cover');
      toast.success('Cover updated');
    } catch (err) {
      toast.error('Cover upload failed', err instanceof Error ? err.message : 'Try again');
      setBusy(null);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /**
   * Take the cover off.
   *
   * Not the same as replacing it: a producer who wants their brand artwork
   * back has, until now, had no way to say so — the only affordance was to
   * upload something else. Clearing to null hands the item back to the
   * per-kind default set in Settings.
   */
  const removeCover = async () => {
    await patch({ cover_url: null }, 'cover');
    toast.success('Cover removed');
  };

  /**
   * Copy the project and its track list.
   *
   * Done client-side in three calls rather than behind a new endpoint: the
   * junction rows are the only thing to copy, `POST /api/projects/[id]/tracks`
   * already appends a batch of them, and every call is owner-gated by the same
   * routes the rest of this menu uses.
   */
  const duplicate = async () => {
    setBusy('duplicate');
    try {
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${project.name} copy` }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !created?.project?.id) {
        throw new Error(created?.error || `HTTP ${createRes.status}`);
      }
      const newId = created.project.id as string;

      // Carry the shape of the project over, but never `store_featured` — a
      // copy should not silently appear on the public storefront.
      await fetch(`/api/projects/${newId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cover_url: project.cover_url ?? null,
          description: project.description ?? null,
          bpm_target: project.bpm_target ?? null,
          key_target: project.key_target ?? null,
        }),
      });

      const tracksRes = await fetch(`/api/tracks?project_id=${project.id}`);
      const tracksJson = await tracksRes.json().catch(() => []);
      const ids: string[] = (Array.isArray(tracksJson) ? tracksJson : tracksJson.tracks ?? [])
        .map((t: { id: string }) => t.id);
      if (ids.length) {
        await fetch(`/api/projects/${newId}/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track_ids: ids }),
        });
      }

      toast.success('Project duplicated', `${project.name} copy · ${ids.length} track${ids.length === 1 ? '' : 's'}`);
      onChanged?.();
    } catch (err) {
      toast.error('Couldn’t duplicate', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmToast(`Delete "${project.name}"?`,
      'Removes the project (its tracks stay in your library). Cannot be undone.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    if (!ok) return;
    setBusy('delete');
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Project deleted');
      if (onDeleted) onDeleted();
      else onChanged?.();
    } catch (err) {
      toast.error('Couldn’t delete', err instanceof Error ? err.message : 'Try again');
      setBusy(null);
    }
  };

  const copyShareLink = async () => {
    setBusy('share');
    try {
      const res = await fetch(`/api/projects/${project.id}/shares`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'viewer', allow_downloads: true, label: 'Quick share' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const url = `${window.location.origin}/projects/share/${data.share?.token ?? data.token}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast.success('Share link copied!');
    } catch (err) {
      toast.error("Couldn't create share link", err instanceof Error ? err.message : '');
    } finally {
      setBusy(null);
    }
  };

  const curStatus = (project.status || 'in_progress') as ProjectStatus;
  const isPinned = !!project.pinned;

  const sections: MenuSection[] = [
    {
      id: 'edit',
      items: [
        {
          id: 'title', label: 'Edit title', shortcut: 'R', shortcutKey: 'r',
          hidden: !onEditTitle, onSelect: () => onEditTitle?.(),
        },
        {
          id: 'tags', label: 'Edit tags', shortcut: 'T', shortcutKey: 't',
          hidden: !onEditTags, onSelect: () => onEditTags?.(),
        },
        {
          id: 'description', label: 'Edit description', shortcut: 'D', shortcutKey: 'd',
          hidden: !onEditDescription, onSelect: () => onEditDescription?.(),
        },
      ],
    },
    {
      id: 'status',
      label: 'Status',
      items: STATUSES.map((s) => ({
        id: `status-${s.value}`,
        label: s.label,
        checked: curStatus === s.value,
        busy: busy === `status-${s.value}`,
        onSelect: async () => {
          if (curStatus === s.value) return;
          if (onSetStatus) { onSetStatus(s.value); return; }
          await patch({ status: s.value }, `status-${s.value}`);
        },
      })),
    },
    {
      id: 'content',
      label: 'Content',
      items: [
        {
          id: 'cover-inline', label: 'Edit cover', hint: 'Crop, replace, or clear',
          hidden: !onEditCover, onSelect: () => onEditCover?.(),
        },
        {
          id: 'cover-upload', label: 'Upload new cover', busy: busy === 'cover',
          hidden: !!onEditCover,
          onSelect: () => { fileRef.current?.click(); return 'keep-open' as const; },
        },
        {
          id: 'cover-remove', label: 'Remove cover', busy: busy === 'cover',
          hidden: !project.cover_url || !!onEditCover, onSelect: removeCover,
        },
        { id: 'share', label: 'Copy share link', busy: busy === 'share', onSelect: copyShareLink },
      ],
    },
    {
      id: 'project',
      label: 'Project',
      items: [
        {
          id: 'pin', label: isPinned ? 'Unpin' : 'Pin to top', busy: busy === 'pin',
          checked: isPinned,
          onSelect: async () => {
            const ok = await patch({ pinned: !isPinned }, 'pin');
            if (ok) toast.success(isPinned ? 'Unpinned' : 'Pinned to top');
          },
        },
        {
          id: 'duplicate', label: 'Duplicate', busy: busy === 'duplicate',
          hint: trackCount != null ? `Copies ${trackCount} track${trackCount === 1 ? '' : 's'}` : undefined,
          onSelect: duplicate,
        },
        { id: 'folders', label: 'Move to folders…', onSelect: () => setShowFolders(true) },
        { id: 'template', label: 'Apply template…', onSelect: () => setShowTemplate(true) },
      ],
    },
    {
      id: 'danger',
      danger: true,
      items: [
        { id: 'delete', label: 'Delete project', busy: busy === 'delete', onSelect: handleDelete },
      ],
    },
  ];

  return (
    <>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onCoverFile} />
      <ActionMenu
        sections={sections}
        align={align}
        label="Project options"
        busy={!!busy}
        className="bg-black/40 backdrop-blur-sm"
      />

      {/* Both modals portaled to document.body so they escape any
          overflow:hidden / stacking-context on the card grid. */}
      {showFolders && createPortal(
        <ProjectFolderSelect projectId={project.id} onClose={() => setShowFolders(false)} onSaved={onChanged} />,
        document.body,
      )}
      {showTemplate && createPortal(
        <TemplatePicker projectId={project.id} onClose={() => setShowTemplate(false)} onApplied={onChanged} />,
        document.body,
      )}
    </>
  );
}
