'use client';

/**
 * The section stack.
 *
 * Reads top-to-bottom in PAGE order rather than reversed like a layer panel,
 * because a storefront is a document you scroll, not a stack you look down
 * through. Getting that backwards is a small thing that makes a builder feel
 * wrong immediately.
 *
 * Reordering is drag-and-drop with an arrow-button fallback. The fallback is
 * not decoration: native HTML5 drag does not fire on touch at all, and the rest
 * of this codebase already pairs the two for exactly that reason.
 */

import { useRef, useState } from 'react';
import {
  AlignLeft, Anchor, BadgeCheck, ChevronDown, ChevronUp, Clock, Copy, Eye, EyeOff, Image as ImageIcon,
  LayoutGrid, Layers, Link2, ListMusic, Lock, Music, PanelTop, Shapes, Sparkles, Star, Trash2, Unlock, Video,
  type LucideIcon,
} from 'lucide-react';
import {
  isPinnedSection, resolveSection, storeBreakpoints,
  type StoreBreakpoint, type StoreLayout, type StoreSectionKind,
} from '@/lib/store-editor/layout';
import { cn } from '@/lib/utils';

/** Layer thumbnail per kind — Photoshop gives every layer a glyph you can scan. */
const KIND_ICON: Record<StoreSectionKind, LucideIcon> = {
  hero: PanelTop,
  countdown: Clock,
  'featured-projects': Layers,
  'featured-playlists': ListMusic,
  spotlight: Sparkles,
  'producer-picks': Star,
  catalog: Music,
  trust: BadgeCheck,
  text: AlignLeft,
  image: ImageIcon,
  video: Video,
  links: Link2,
  canvas: Shapes,
};

export function SectionsPanel({
  layout, selectedId, breakpoint, onSelect, onReorder, onMove, onToggle, onDuplicate, onDelete, onRename,
}: {
  layout: StoreLayout;
  selectedId: string | null;
  breakpoint: StoreBreakpoint;
  onSelect: (id: string) => void;
  onReorder: (id: string, toIndex: number) => void;
  onMove: (id: string, delta: number) => void;
  onToggle: (id: string, patch: { visible?: boolean; locked?: boolean }) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const selectedIndex = layout.sections.findIndex((s) => s.id === selectedId);
  const selected = selectedIndex >= 0 ? layout.sections[selectedIndex] : null;
  const selectedPinned = selected ? isPinnedSection(selected.kind) : false;

  /*
   * The Photoshop Layers panel, not a list of cards:
   *   eye | thumbnail | name ............ lock
   * The eye column is ALWAYS visible (visibility is the thing you toggle most),
   * the lock shows only when a layer is locked, and actions on the selected
   * layer live in a fixed bar at the foot of the panel — so rows stay quiet
   * instead of sprouting six icons on hover. ↑/↓ move the selection.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul
        role="listbox"
        aria-label="Sections"
        tabIndex={0}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const next = layout.sections[Math.min(layout.sections.length - 1, Math.max(0, (selectedIndex < 0 ? -1 : selectedIndex) + delta))];
            if (next) onSelect(next.id);
          }
          if (event.key === 'Enter' && selectedId) { event.preventDefault(); setRenaming(selectedId); }
        }}
        className="min-h-0 flex-1 overflow-y-auto py-1 outline-none focus-visible:shadow-[inset_2px_0_0_rgba(255,255,255,0.5)]"
      >
        {layout.sections.map((section, index) => {
          const settings = resolveSection(section, breakpoint);
          const isSelected = section.id === selectedId;
          const hiddenHere = !settings.visible;
          // Catalogue + trust rail are anchored on the live storefront, so the
          // drag is disabled rather than accepted and then ignored.
          const pinned = isPinnedSection(section.kind);
          const changed = storeBreakpoints.filter(
            (point) => point !== 'desktop' && Object.keys(section.overrides[point] ?? {}).length > 0,
          );
          const Icon = KIND_ICON[section.kind] ?? LayoutGrid;

          return (
            <li
              key={section.id}
              role="option"
              aria-selected={isSelected}
              draggable={!section.locked && !pinned}
              onDragStart={() => { dragIndex.current = index; }}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragIndex.current !== null && dragIndex.current !== index) setDragOver(index);
              }}
              onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragIndex.current;
                dragIndex.current = null;
                setDragOver(null);
                if (from !== null && from !== index) onReorder(layout.sections[from].id, index);
              }}
              onDragEnd={() => { dragIndex.current = null; setDragOver(null); }}
              onClick={() => onSelect(section.id)}
              onDoubleClick={() => setRenaming(section.id)}
              className={cn(
                'group relative flex h-10 cursor-default select-none items-center border-b border-white/[0.04] pr-2 transition-colors',
                isSelected ? 'bg-white/[0.10]' : 'hover:bg-white/[0.04]',
                dragOver === index && 'shadow-[inset_0_2px_0_rgba(255,255,255,0.6)]',
                !section.locked && !pinned && 'active:cursor-grabbing',
              )}
            >
              {/* Eye column */}
              <button
                type="button"
                aria-label={settings.visible ? `Hide ${section.name} on ${breakpoint}` : `Show ${section.name} on ${breakpoint}`}
                title={settings.visible ? `Hide on ${breakpoint}` : `Show on ${breakpoint}`}
                onClick={(event) => { event.stopPropagation(); onToggle(section.id, { visible: !settings.visible }); }}
                className="grid h-full w-8 shrink-0 place-items-center border-r border-white/[0.06] text-white/50 transition-colors hover:text-white"
              >
                {settings.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-white/20" />}
              </button>

              {/* Thumbnail */}
              <span
                aria-hidden
                className={cn(
                  'mx-2 grid size-6 shrink-0 place-items-center rounded-[3px] border',
                  isSelected ? 'border-white/40 bg-white/[0.12] text-white/90' : 'border-white/10 bg-[#090907] text-white/50',
                )}
              >
                <Icon size={12} />
              </span>

              {/* Name */}
              <span className="min-w-0 flex-1">
                {renaming === section.id ? (
                  <input
                    autoFocus
                    aria-label="Section name"
                    defaultValue={section.name}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={(event) => { onRename(section.id, event.target.value); setRenaming(null); }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter') { onRename(section.id, event.currentTarget.value); setRenaming(null); }
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                    className="w-full rounded-[3px] border border-white/30 bg-[#090907] px-1 py-0.5 text-[11px] text-white/90 outline-none"
                  />
                ) : (
                  <span className={cn(
                    'block truncate text-[11px]',
                    hiddenHere ? 'text-white/30' : isSelected ? 'text-white' : 'text-white/70',
                  )}
                  >
                    {section.name}
                  </span>
                )}
              </span>

              {/* Right: device overrides, anchor, lock */}
              <span className="ml-1 flex shrink-0 items-center gap-1">
                {changed.map((point) => (
                  <span
                    key={point}
                    title={`Changed on ${point}`}
                    className="font-mono text-[8px] uppercase text-white/40"
                  >
                    {point[0]}
                  </span>
                ))}
                {pinned ? <span title="Anchored to the bottom of the storefront"><Anchor size={10} className="text-white/25" aria-label="Anchored" /></span> : null}
                <button
                  type="button"
                  aria-label={section.locked ? `Unlock ${section.name}` : `Lock ${section.name}`}
                  title={section.locked ? 'Unlock' : 'Lock'}
                  onClick={(event) => { event.stopPropagation(); onToggle(section.id, { locked: !section.locked }); }}
                  className={cn(
                    'grid size-5 place-items-center transition-opacity',
                    section.locked ? 'text-white/60' : 'text-white/30 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                  )}
                >
                  {section.locked ? <Lock size={10} /> : <Unlock size={10} />}
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {/* Panel foot — Photoshop's layer action strip. Acts on the selection. */}
      <div className="flex h-8 shrink-0 items-center justify-end gap-0.5 border-t border-white/10 px-1.5">
        <span className="mr-auto pl-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
          {layout.sections.length} layers
        </span>
        <IconAction
          label={!selected ? 'Select a section' : selectedPinned ? 'Anchored' : 'Move up'}
          disabled={!selected || selectedPinned || selectedIndex === 0}
          onClick={() => selected && onMove(selected.id, -1)}
        ><ChevronUp size={12} /></IconAction>
        <IconAction
          label={!selected ? 'Select a section' : selectedPinned ? 'Anchored' : 'Move down'}
          disabled={!selected || selectedPinned || selectedIndex === layout.sections.length - 1}
          onClick={() => selected && onMove(selected.id, 1)}
        ><ChevronDown size={12} /></IconAction>
        <IconAction
          label="Duplicate (⌘D)"
          disabled={!selected}
          onClick={() => selected && onDuplicate(selected.id)}
        ><Copy size={12} /></IconAction>
        <IconAction
          label={selected?.locked ? 'Locked' : 'Delete (Del)'}
          disabled={!selected || selected.locked}
          onClick={() => selected && onDelete(selected.id)}
        ><Trash2 size={12} /></IconAction>
      </div>
    </div>
  );
}

function IconAction({ label, disabled, onClick, children }: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/90 disabled:cursor-not-allowed disabled:text-white/15 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
