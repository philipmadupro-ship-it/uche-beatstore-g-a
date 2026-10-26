'use client';

/**
 * The filter bar on Music and Releases (LABEL-37): the applied filters as
 * removable chips (the `InlineTagStrip` pill), a Filter button that opens the
 * editor, and the saved-views menu. It is presentational over
 * `useOrgFilter`; the rows below it are the page's.
 *
 * A saved view is only ever a definition. Picking one runs it again for THIS
 * viewer, so a view an owner shared can show a scoped member fewer rows, and
 * the note under the bar says when part of it is out of their reach — without
 * saying what.
 */
import { useState, type FormEvent } from 'react';
import { Bookmark, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { FilterEditor, type Choice } from '@/components/labelos/FilterEditor';
import type { useOrgFilter } from '@/components/labelos/useOrgFilter';
import { confirmToast, toast } from '@/hooks/useToast';
import { describeFilter, isEmptyFilter, removeChip } from '@/lib/labelos/filters';

type Filter = ReturnType<typeof useOrgFilter>;

export function FilterBar({
  filter,
  artists,
  people,
  canRights,
  canApprovals,
}: {
  filter: Filter;
  artists: Choice[];
  people: Choice[];
  canRights: boolean;
  canApprovals: boolean;
}) {
  const [editing, setEditing] = useState(0); // a counter, so every opening remounts the editor with a fresh draft
  const [saving, setSaving] = useState(false);
  const { definition, names, activeView, views, viewsReady, canShare, narrowed } = filter;
  const chips = describeFilter(definition, names);
  const empty = isEmptyFilter(definition);

  const sections: MenuSection[] = [
    {
      id: 'views',
      label: 'Saved views',
      items: views.map((v) => ({
        id: `view:${v.id}`,
        label: v.name,
        hint: v.mine ? (v.shared ? 'Yours · shared' : 'Yours') : `Shared by ${v.author ?? 'a member'}`,
        checked: v.id === activeView?.id,
        onSelect: () => filter.applyView(v),
      })),
    },
    {
      id: 'save',
      items: [
        { id: 'save-as', label: 'Save as a view…', hidden: !viewsReady || empty, onSelect: () => setSaving(true) },
        {
          id: 'update',
          label: `Update “${activeView?.name ?? ''}” with these filters`,
          // A narrowed definition is missing ids this viewer cannot see: saving it would widen the view for everyone.
          hidden: !activeView?.canEdit || empty || narrowed,
          onSelect: async () => {
            const res = await filter.update(activeView!.id, { definition });
            if (res.ok) toast.success('View updated');
            else toast.error(res.error);
          },
        },
        {
          id: 'share',
          label: activeView?.shared ? 'Make this view just mine' : 'Share this view with the organization',
          hidden: !activeView?.canEdit || (!activeView.shared && !canShare),
          onSelect: async () => {
            const res = await filter.update(activeView!.id, { shared: !activeView!.shared });
            if (res.ok) toast.success(activeView!.shared ? 'Only you can see this view now' : 'Shared with the organization');
            else toast.error(res.error);
          },
        },
        {
          id: 'unshare',
          label: 'Take this shared view down',
          hidden: !activeView?.canUnshare,
          onSelect: async () => {
            const res = await filter.update(activeView!.id, { shared: false });
            if (res.ok) toast.success('The view is personal to its author again');
            else toast.error(res.error);
          },
        },
      ],
    },
    {
      id: 'danger',
      danger: true,
      items: [
        {
          id: 'delete',
          label: 'Delete this view',
          hidden: !activeView?.canDelete,
          onSelect: async () => {
            const ok = await confirmToast(`Delete “${activeView!.name}”?`, activeView!.shared ? 'It disappears for everyone it was shared with.' : 'This cannot be undone.', { confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            const res = await filter.remove(activeView!.id);
            if (res.ok) toast.success('View deleted');
            else toast.error(res.error);
          },
        },
      ],
    },
  ];

  return (
    <div className="mb-5 space-y-2" data-testid="filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal size={12} aria-hidden />} onClick={() => setEditing((n) => n + 1)}>
          Filter{chips.length > 0 ? ` · ${chips.length}` : ''}
        </Button>
        <ActionMenu
          label="Saved views"
          align="left"
          width={288}
          triggerClassName="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[10px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
          triggerContent={
            <>
              <Bookmark size={12} aria-hidden />
              <span>{activeView ? activeView.name : 'Views'}</span>
              <ChevronDown size={11} aria-hidden />
            </>
          }
          sections={sections}
        />
        {chips.map((c) => (
          <span
            key={c.key}
            data-testid="filter-chip"
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2.5 pr-1 text-[10px] font-medium text-white/70"
          >
            {c.label}
            <button
              type="button"
              aria-label={`Remove filter ${c.label}`}
              onClick={() => filter.setDefinition(removeChip(definition, c.key))}
              className="grid size-4 place-items-center rounded-full text-white/30 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={10} aria-hidden />
            </button>
          </span>
        ))}
        {!empty && (
          <button type="button" onClick={filter.clear} className="text-[10px] text-white/40 underline-offset-2 hover:text-white hover:underline">
            Clear all
          </button>
        )}
      </div>
      {narrowed && (
        <p role="note" className="text-[10px] text-white/40">
          Part of this view is outside what you can see, so you are shown the rest.
        </p>
      )}
      {!viewsReady && <p className="text-[10px] text-white/40">Saving views needs the latest database update.</p>}

      {editing > 0 && (
        <FilterEditor
          key={editing}
          open
          onClose={() => setEditing(0)}
          definition={definition}
          artists={artists}
          people={people}
          canRights={canRights}
          canApprovals={canApprovals}
          onApply={(next) => {
            setEditing(0);
            filter.setDefinition(next);
          }}
        />
      )}
      {saving && <SaveViewDialog canShare={canShare} onClose={() => setSaving(false)} onSave={filter.save} />}
    </div>
  );
}

function SaveViewDialog({
  canShare,
  onClose,
  onSave,
}: {
  canShare: boolean;
  onClose: () => void;
  onSave: Filter['save'];
}) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the view a name');
      return;
    }
    setBusy(true);
    const res = await onSave(name.trim(), shared && canShare);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(`Saved “${name.trim()}”`);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Save this view"
      description="A view remembers the filters, not the results. It is recomputed every time, for whoever opens it."
      size="sm"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={error ?? undefined} autoFocus />
        {canShare && (
          <label className="flex items-start gap-2.5 text-[11px] text-white/70">
            <input type="checkbox" className="mt-0.5" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>
              Share with the organization
              <span className="mt-0.5 block text-[10px] text-white/40">Members see the rows their own role and artists allow — never more than they could open themselves.</span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" loading={busy}>Save view</Button>
        </div>
      </form>
    </Modal>
  );
}
