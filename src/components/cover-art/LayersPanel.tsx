'use client';

/**
 * The layer stack.
 *
 * Top of the list is the front of the artwork, which is the convention every
 * design tool uses and the opposite of the underlying zIndex order — so the
 * list is reversed here rather than in the document, where painting order has
 * to stay ascending.
 *
 * Reordering is by button rather than drag: the canvas already owns pointer
 * dragging, and a second drag system in a narrow scrolling list is where this
 * kind of panel usually goes wrong.
 */

import { useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, Copy, Eye, EyeOff, FolderOpen, GripVertical, Lock, Trash2, Unlock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LayerView } from './LayerView';
import { layerRows, sortArtworkLayers, type ArtworkDocument, type ArtworkLayer, type LayerReorder } from './cover-art-document';

function layerKindLabel(layer: ArtworkLayer) {
  if (layer.type === 'text') return layer.text.slice(0, 28) || 'Empty text';
  if (layer.type === 'image') return layer.src ? layer.label : 'Empty image frame';
  if (layer.type === 'shape') return layer.shape;
  if (layer.type === 'texture') return layer.texture;
  if (layer.type === 'group') return 'Group';
  return `${layer.mode} waveform`;
}

function LayerThumb({ layer, palette }: { layer: ArtworkLayer; palette: ArtworkDocument['palette'] }) {
  // The thumbnail is the real renderer at a tiny scale, so it can never drift
  // from what the canvas shows.
  const scale = 36 / Math.max(layer.width, layer.height);
  return (
    <span className="relative block h-9 w-9 shrink-0 overflow-hidden border border-white/10 bg-[#090907]">
      <span
        className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2"
        style={{ width: layer.width * scale, height: layer.height * scale }}
      >
        <LayerView layer={layer} zoom={scale} palette={palette} />
      </span>
    </span>
  );
}

export function LayersPanel({
  document: doc,
  selectedIds,
  onSelect,
  onReorder,
  onToggle,
  onRename,
  onDuplicate,
  onDelete,
}: {
  document: ArtworkDocument;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onReorder: (id: string, move: LayerReorder) => void;
  onToggle: (id: string, patch: { visible?: boolean; locked?: boolean; collapsed?: boolean }) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // The flattened tree, front-to-back, with collapsed groups omitting their
  // contents entirely rather than hiding them with CSS — a folded group of
  // forty layers should cost nothing to render.
  const stack = layerRows(doc.layers);

  return (
    <ul className="grid gap-1">
      {stack.map(({ layer, depth, hasChildren }, index) => {
        const selected = selectedIds.includes(layer.id);
        const isGroup = layer.type === 'group';
        return (
          <li
            key={layer.id}
            className={cn(
              'group relative grid grid-cols-[auto_2.25rem_minmax(0,1fr)] items-center gap-2 border px-1.5 py-1.5 transition-colors',
              selected ? 'border-white/40 bg-white/[0.08]' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]',
            )}
          >
            {/* Depth is an inline indent rather than a class, because nesting
                is unbounded and Tailwind cannot generate a class per level. */}
            <span className="flex items-center" style={{ paddingLeft: depth * 10 }}>
              {isGroup && hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggle(layer.id, { collapsed: !layer.collapsed })}
                  aria-expanded={!layer.collapsed}
                  aria-label={layer.collapsed ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
                  title={layer.collapsed ? 'Expand' : 'Collapse'}
                  className="grid size-3.5 place-items-center text-white/40 transition-colors hover:text-white/90"
                >
                  <ChevronRight size={11} className={cn('transition-transform', !layer.collapsed && 'rotate-90')} />
                </button>
              ) : (
                <GripVertical aria-hidden size={12} className="text-white/25" />
              )}
            </span>
            {isGroup ? (
              <span
                aria-hidden
                className="grid size-9 place-items-center border border-white/10 bg-white/[0.03] text-white/40"
              >
                <FolderOpen size={13} />
              </span>
            ) : (
              <LayerThumb layer={layer} palette={doc.palette} />
            )}

            {renamingId === layer.id ? (
              <input
                autoFocus
                defaultValue={layer.name}
                onBlur={(event) => {
                  onRename(layer.id, event.target.value.trim() || layer.name);
                  setRenamingId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') setRenamingId(null);
                }}
                className="h-7 w-full border border-white/30 bg-[#090907] px-1.5 text-[12px] text-white/90 outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  onSelect(event.shiftKey
                    ? selected ? selectedIds.filter((id) => id !== layer.id) : [...selectedIds, layer.id]
                    : [layer.id]);
                }}
                onDoubleClick={() => setRenamingId(layer.id)}
                className="min-w-0 text-left"
              >
                <span className="block truncate text-[12px] text-white/90">{layer.name}</span>
                <span className="block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                  {layerKindLabel(layer)}
                </span>
              </button>
            )}

            {/* Absolutely positioned, not a grid column: as a column the six
                buttons reserved ~150px of a 250px row and squeezed every layer
                name down to a single letter. */}
            <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 bg-[#0D0D0A] pl-1 opacity-0 shadow-[-8px_0_8px_-4px_#0D0D0A] transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <IconAction
                label={index === 0 ? 'Already at front' : `Bring ${layer.name} forward`}
                disabled={index === 0}
                onClick={() => onReorder(layer.id, 'forward')}
              >
                <ChevronUp size={12} />
              </IconAction>
              <IconAction
                label={index === stack.length - 1 ? 'Already at back' : `Send ${layer.name} backward`}
                disabled={index === stack.length - 1}
                onClick={() => onReorder(layer.id, 'backward')}
              >
                <ChevronDown size={12} />
              </IconAction>
              <IconAction label={`Duplicate ${layer.name}`} onClick={() => onDuplicate(layer.id)}>
                <Copy size={12} />
              </IconAction>
              <IconAction
                label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                active={!layer.visible}
                onClick={() => onToggle(layer.id, { visible: !layer.visible })}
              >
                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </IconAction>
              <IconAction
                label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                active={layer.locked}
                onClick={() => onToggle(layer.id, { locked: !layer.locked })}
              >
                {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </IconAction>
              <IconAction
                label={layer.locked ? `${layer.name} is locked` : `Delete ${layer.name}`}
                disabled={layer.locked}
                onClick={() => onDelete(layer.id)}
              >
                <Trash2 size={12} />
              </IconAction>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function IconAction({ children, label, onClick, disabled, active }: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-6 w-6 place-items-center transition-colors disabled:opacity-25',
        active ? 'text-white' : 'text-white/40 hover:text-white/90',
      )}
    >
      {children}
    </button>
  );
}
