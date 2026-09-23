'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  /** Return false to reject the edit and stay in edit mode. */
  onSave: (next: string) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  /** Multi-line uses a textarea: Enter inserts a newline, ⌘/Ctrl+Enter saves. */
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  /** Classes for the resting display element. */
  className?: string;
  /** Classes for the input while editing — keep the type identical to the
   *  display so the text does not jump when the field appears. */
  inputClassName?: string;
  /** Accessible name, e.g. "Project title". */
  label: string;
  /** Externally driven edit state, for a menu item that opens this editor. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Rendered instead of `value` when the value is empty. */
  emptyLabel?: string;
  /** Hide the pencil affordance (the whole row is already obviously clickable). */
  hideAffordance?: boolean;
}

/**
 * Click-to-edit text. The app's default for any action that changes exactly
 * one string property.
 *
 * The interaction hierarchy is direct manipulation → popover → menu → modal;
 * this is the first rung, and it exists so that renaming a project stops being
 * "open the ⋯ menu, find Rename, type, click Save".
 *
 * Save/cancel semantics are deliberately the ones people already have muscle
 * memory for from Finder and every spreadsheet:
 *
 *  - Enter saves (⌘/Ctrl+Enter in multiline, where Enter is a newline).
 *  - Escape cancels and restores the original value.
 *  - Blur saves rather than discards. Discarding on blur silently throws away
 *    typing whenever the user clicks anywhere else, which is the single most
 *    expensive way an inline editor can fail.
 *  - An unchanged or empty-after-trim value is a no-op, never a PATCH.
 */
export function InlineText({
  value, onSave, placeholder, multiline = false, rows = 3, maxLength,
  className, inputClassName, label, editing: controlledEditing, onEditingChange,
  emptyLabel, hideAffordance = false,
}: Props) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const editing = controlledEditing ?? uncontrolled;
  const setEditing = (v: boolean) => {
    if (controlledEditing === undefined) setUncontrolled(v);
    onEditingChange?.(v);
  };

  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Guards the blur handler: Escape and the explicit cancel button both blur
  // the field on their way out, and without this the blur would immediately
  // re-save the value the user just discarded.
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Re-seed the draft whenever the editor opens or the upstream value changes
  // underneath a closed editor (a refetch, a change made from a menu).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    cancelledRef.current = false;
    const el = inputRef.current;
    if (el) { el.focus(); el.select?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = async () => {
    if (cancelledRef.current || saving) return;
    const next = draft.trim();
    if (next === value.trim()) { setEditing(false); return; }
    setSaving(true);
    const result = await onSave(next);
    setSaving(false);
    if (result === false) {
      inputRef.current?.focus();
      return;
    }
    setEditing(false);
  };

  const cancel = () => {
    cancelledRef.current = true;
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label}`}
        className={cn(
          'group/inline flex max-w-full items-center gap-2 rounded-lg text-left transition-colors',
          'hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
          className,
        )}
      >
        <span className={cn('min-w-0', !value.trim() && 'text-white/30')}>
          {value.trim() || emptyLabel || placeholder || '—'}
        </span>
        {!hideAffordance && (
          <Pencil
            size={12}
            className="shrink-0 text-white/30 opacity-0 transition-opacity group-hover/inline:opacity-100 group-focus-visible/inline:opacity-100"
          />
        )}
      </button>
    );
  }

  const shared = {
    ref: (el: HTMLInputElement & HTMLTextAreaElement | null) => { inputRef.current = el; },
    value: draft,
    maxLength,
    placeholder,
    'aria-label': label,
    disabled: saving,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => { void commit(); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void commit();
      }
    },
  };

  return (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      {multiline ? (
        <textarea
          {...shared}
          rows={rows}
          className={cn(
            'min-w-0 flex-1 resize-none rounded-lg border border-white/20 bg-white/[0.04] px-3 py-2',
            'text-white leading-relaxed outline-none transition-colors focus:border-white/40 disabled:opacity-60',
            inputClassName,
          )}
        />
      ) : (
        <input
          {...shared}
          className={cn(
            'min-w-0 flex-1 border-b-2 border-white/40 bg-transparent text-white outline-none',
            'transition-colors focus:border-white disabled:opacity-60',
            inputClassName,
          )}
        />
      )}
      {/* Pointer users get explicit controls; mousedown (not click) so the
          field's blur-commit does not tear the buttons out from under the
          press. */}
      <span className="flex shrink-0 items-center gap-1 pt-0.5">
        <button
          type="button"
          aria-label={`Save ${label}`}
          onMouseDown={(e) => { e.preventDefault(); void commit(); }}
          className="rounded-lg bg-white/10 p-1.5 text-white transition-colors hover:bg-white/20"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button
          type="button"
          aria-label={`Cancel editing ${label}`}
          onMouseDown={(e) => { e.preventDefault(); cancel(); }}
          className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={13} />
        </button>
      </span>
      {multiline && (
        <span className="sr-only">Press Command or Control plus Enter to save.</span>
      )}
    </span>
  );
}
