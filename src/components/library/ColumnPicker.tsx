'use client';

import { useState } from 'react';
import { Columns3, GripVertical, Check, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { LIBRARY_COLUMNS, REQUIRED_COLUMN_IDS, getColumn } from '@/lib/library/columns';
import { useLibraryColumns } from '@/hooks/useLibraryColumns';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/**
 * Show, hide, reorder and save library column layouts.
 *
 * Reordering is drag-and-drop with keyboard equivalents, not drag-only. A
 * drag-only control is unusable without a pointer, and "reorder your columns"
 * is not a niche enough action to justify locking anyone out of it — the
 * arrow buttons are the accessible path and cost one icon each.
 */
export function ColumnPicker() {
  const columnIds = useLibraryColumns((s) => s.columnIds);
  const toggle = useLibraryColumns((s) => s.toggle);
  const move = useLibraryColumns((s) => s.move);
  const reset = useLibraryColumns((s) => s.reset);
  const layouts = useLibraryColumns((s) => s.layouts);
  const saveLayout = useLibraryColumns((s) => s.saveLayout);
  const applyLayout = useLibraryColumns((s) => s.applyLayout);
  const deleteLayout = useLibraryColumns((s) => s.deleteLayout);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [layoutName, setLayoutName] = useState('');

  const shown = columnIds.map((id) => getColumn(id)).filter(Boolean);
  const hidden = LIBRARY_COLUMNS.filter((c) => !columnIds.includes(c.id));

  const onSave = () => {
    const name = layoutName.trim();
    if (!name) { toast.error('Name the layout first'); return; }
    saveLayout(name);
    setLayoutName('');
    toast.success(`Layout "${name}" saved`);
  };

  return (
    <Popover
      width={288}
      align="right"
      trigger={({ open, toggle: t, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          onClick={t}
          aria-expanded={open}
          aria-haspopup="true"
          title="Columns"
          className={cn(
            'tap inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors',
            open
              ? 'border-white/25 bg-white/[0.13] text-white'
              : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:text-white',
          )}
        >
          <Columns3 size={13} />
          Columns
        </button>
      )}
    >
      {() => (
        <div className="max-h-[min(70vh,460px)] overflow-y-auto p-2">
          <p className="px-1 pb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
            Shown · drag to reorder
          </p>

          <ul className="space-y-0.5">
            {shown.map((col, i) => {
              const required = REQUIRED_COLUMN_IDS.includes(col!.id);
              return (
                <li
                  key={col!.id}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex != null) move(dragIndex, i);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors',
                    dragIndex === i ? 'bg-white/[0.10]' : 'hover:bg-white/[0.05]',
                  )}
                >
                  <GripVertical size={12} className="shrink-0 cursor-grab text-white/25" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{col!.label}</span>

                  {/* Keyboard path for reordering. */}
                  <button
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    aria-label={`Move ${col!.label} earlier`}
                    className="tap grid size-6 place-items-center rounded text-white/40 transition-colors hover:text-white disabled:opacity-20"
                  >↑</button>
                  <button
                    onClick={() => move(i, i + 1)}
                    disabled={i === shown.length - 1}
                    aria-label={`Move ${col!.label} later`}
                    className="tap grid size-6 place-items-center rounded text-white/40 transition-colors hover:text-white disabled:opacity-20"
                  >↓</button>
                  <button
                    onClick={() => toggle(col!.id)}
                    disabled={required}
                    aria-label={required ? `${col!.label} is always shown` : `Hide ${col!.label}`}
                    title={required ? 'Always shown' : 'Hide'}
                    className="tap grid size-6 place-items-center rounded text-[var(--accent)] transition-colors hover:bg-white/[0.08] disabled:opacity-25"
                  >
                    <Check size={12} />
                  </button>
                </li>
              );
            })}
          </ul>

          {hidden.length > 0 && (
            <>
              <p className="px-1 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
                Hidden
              </p>
              <ul className="space-y-0.5">
                {hidden.map((col) => (
                  <li key={col.id}>
                    <button
                      onClick={() => toggle(col.id)}
                      className="tap flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[12px] text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white"
                    >
                      <span className="size-3 shrink-0 rounded-[3px] border border-white/20" aria-hidden />
                      <span className="truncate">{col.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Saved layouts */}
          <div className="mt-3 border-t border-white/10 pt-2">
            <p className="px-1 pb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
              Layouts
            </p>
            {layouts.length > 0 && (
              <ul className="mb-2 space-y-0.5">
                {layouts.map((l) => (
                  <li key={l.name} className="flex items-center gap-1">
                    <button
                      onClick={() => applyLayout(l.name)}
                      className="tap min-w-0 flex-1 truncate rounded-lg px-1.5 py-1.5 text-left text-[12px] text-white/75 transition-colors hover:bg-white/[0.05] hover:text-white"
                    >
                      {l.name}
                      <span className="ml-1.5 font-mono text-[9px] text-white/30">{l.columnIds.length}</span>
                    </button>
                    <button
                      onClick={() => deleteLayout(l.name)}
                      aria-label={`Delete layout ${l.name}`}
                      className="tap grid size-6 shrink-0 place-items-center rounded text-white/30 transition-colors hover:text-[var(--error-text)]"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-1.5">
              <input
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
                placeholder="Layout name"
                aria-label="Layout name"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
              />
              <button
                onClick={onSave}
                aria-label="Save layout"
                className="tap grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 transition-colors hover:text-white"
              >
                <Save size={12} />
              </button>
            </div>

            <button
              onClick={() => { reset(); toast.success('Columns reset to default'); }}
              className="tap mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <RotateCcw size={11} /> Reset to default
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
