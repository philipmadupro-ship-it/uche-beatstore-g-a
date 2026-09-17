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
  ChevronDown, ChevronUp, Copy, Eye, EyeOff, GripVertical, Lock, Trash2, Unlock,
} from 'lucide-react';
import {
  isPinnedSection, resolveSection, storeBreakpoints,
  type StoreBreakpoint, type StoreLayout,
} from '@/lib/store-editor/layout';
import { cn } from '@/lib/utils';

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

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="border-b border-white/10 px-3 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
          Sections · {layout.sections.length}
        </p>
      </div>

      <ul className="py-1">
        {layout.sections.map((section, index) => {
          const settings = resolveSection(section, breakpoint);
          const selected = section.id === selectedId;
          const hiddenHere = !settings.visible;
          // The catalogue carries the sticky filter toolbar directly above it,
          // and the trust rail is a footer element. Both are anchored on the
          // live storefront, so the drag is disabled rather than accepted and
          // then ignored once published.
          const pinned = isPinnedSection(section.kind);
          // Badge the breakpoints that change this section, so a layout with
          // mobile-specific behaviour is visible without hunting for it.
          const changed = storeBreakpoints.filter(
            (point) => point !== 'desktop' && Object.keys(section.overrides[point] ?? {}).length > 0,
          );

          return (
            <li
              key={section.id}
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
              className={cn(
                'group relative border-l-2 transition-colors',
                selected ? 'border-l-white/70 bg-white/[0.06]' : 'border-l-transparent hover:bg-white/[0.03]',
                dragOver === index && 'border-t border-t-white/40',
              )}
            >
              <div className="flex items-center gap-1.5 px-2 py-2">
                <GripVertical
                  size={12}
                  aria-hidden
                  className={cn(
                    'shrink-0',
                    section.locked || pinned ? 'text-white/10' : 'cursor-grab text-white/20 group-hover:text-white/40',
                  )}
                />

                <button
                  type="button"
                  onClick={() => onSelect(section.id)}
                  onDoubleClick={() => setRenaming(section.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  {renaming === section.id ? (
                    <input
                      autoFocus
                      defaultValue={section.name}
                      onBlur={(event) => { onRename(section.id, event.target.value); setRenaming(null); }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') { onRename(section.id, event.currentTarget.value); setRenaming(null); }
                        if (event.key === 'Escape') setRenaming(null);
                      }}
                      className="w-full border border-white/20 bg-[#090907] px-1 py-0.5 text-[12px] text-white/90 outline-none focus:border-white/60"
                    />
                  ) : (
                    <>
                      <span className={cn(
                        'block truncate text-[12px]',
                        hiddenHere ? 'text-white/30 line-through' : selected ? 'text-white/90' : 'text-white/70',
                      )}
                      >
                        {section.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/25">
                          {section.kind.replace(/-/g, ' ')}
                        </span>
                        {pinned ? (
                          <span
                            title="Anchored to the bottom of the storefront"
                            className="font-mono text-[8px] uppercase tracking-[0.1em] text-white/25"
                          >
                            Pinned
                          </span>
                        ) : null}
                        {changed.map((point) => (
                          <span
                            key={point}
                            title={`Overridden on ${point}`}
                            className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#c8a47a]"
                          >
                            {point[0]}
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                </button>

                {/* Actions stay mounted but only paint on hover/selection, so
                    the list reads as content rather than a wall of icons.
                    Positioned ABSOLUTELY rather than in flow: six icons in the
                    row is ~120px of layout width, and while they were merely
                    transparent they still took that width — which squeezed
                    every section name into "Produc…" even though the panel had
                    room for it. Floating them over a matching background keeps
                    the name at full width until the row is actually hovered. */}
                <span className={cn(
                  'absolute right-0 top-0 flex h-full shrink-0 items-center gap-0.5 bg-gradient-to-l from-[#0D0D0A] from-70% to-transparent pl-6 pr-2 transition-opacity',
                  selected ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
                )}
                >
                  <IconAction
                    label={pinned ? `${section.name} is anchored` : index === 0 ? 'Already first' : `Move ${section.name} up`}
                    disabled={pinned || index === 0}
                    onClick={() => onMove(section.id, -1)}
                  >
                    <ChevronUp size={11} />
                  </IconAction>
                  <IconAction
                    label={pinned ? `${section.name} is anchored` : index === layout.sections.length - 1 ? 'Already last' : `Move ${section.name} down`}
                    disabled={pinned || index === layout.sections.length - 1}
                    onClick={() => onMove(section.id, 1)}
                  >
                    <ChevronDown size={11} />
                  </IconAction>
                  <IconAction label={`Duplicate ${section.name}`} onClick={() => onDuplicate(section.id)}>
                    <Copy size={11} />
                  </IconAction>
                  <IconAction
                    label={settings.visible ? `Hide ${section.name} on ${breakpoint}` : `Show ${section.name} on ${breakpoint}`}
                    onClick={() => onToggle(section.id, { visible: !settings.visible })}
                  >
                    {settings.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                  </IconAction>
                  <IconAction
                    label={section.locked ? `Unlock ${section.name}` : `Lock ${section.name}`}
                    onClick={() => onToggle(section.id, { locked: !section.locked })}
                  >
                    {section.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </IconAction>
                  <IconAction
                    label={section.locked ? `${section.name} is locked` : `Delete ${section.name}`}
                    disabled={section.locked}
                    onClick={() => onDelete(section.id)}
                  >
                    <Trash2 size={11} />
                  </IconAction>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
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
      className="grid size-5 place-items-center text-white/40 transition-colors hover:text-white/90 disabled:cursor-not-allowed disabled:text-white/10"
    >
      {children}
    </button>
  );
}
