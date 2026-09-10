'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  resolveSections, flattenActions, nextEnabledIndex, firstEnabledIndex,
  indexForShortcutKey, type MenuAction, type MenuSection,
} from '@/lib/ui/action-menu';

export type { MenuAction, MenuSection };

interface Props {
  sections: MenuSection[];
  /** Glyph inside the trigger. Defaults to ⋯. */
  triggerContent?: ReactNode;
  /** Skin for the trigger button. The ELEMENT is always ours — callers change
   *  how it looks, never what it is, so the menu can always measure and
   *  re-focus its own trigger. */
  triggerClassName?: string;
  /** Extra classes merged after the default trigger skin. */
  className?: string;
  align?: 'left' | 'right';
  width?: number;
  label?: string;
  /** Shown busy on the default trigger while a background action runs. */
  busy?: boolean;
}

/**
 * The app's one grouped action menu.
 *
 * Replaces the copy-pasted `absolute top-full` menus that each reimplemented
 * open state, outside-click and item markup — and none of which supported the
 * keyboard. Ordering, grouping and danger-last are decided by the pure model in
 * `lib/ui/action-menu`; this file is positioning, focus and paint.
 *
 * Positioning follows `ui/Dropdown`: portaled to <body> so it escapes card
 * overflow and backdrop-blur stacking contexts, `position: fixed` with
 * viewport-relative rect coords (never add window.scrollY), and flipped upward
 * when the menu would otherwise be clipped by the bottom of the window.
 *
 * Keyboard: ↑/↓ move (skipping disabled rows and wrapping), Home/End jump,
 * Enter/Space invoke, Escape closes and restores focus to the trigger, and any
 * item with `shortcutKey` is invocable by that single letter. Focus is NOT
 * trapped — per useDialogBehavior's note, trapping in a `role="menu"` strands
 * keyboard users in a popup they expect to tab out of.
 */
export function ActionMenu({
  sections,
  align = 'right',
  width = 232,
  label = 'More actions',
  busy = false,
  triggerContent,
  triggerClassName,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const resolved = resolveSections(sections);
  const flat = flattenActions(sections);

  /**
   * Stable per-item DOM ids, so the panel can point `aria-activedescendant` at
   * the highlighted row.
   *
   * The keyboard cursor is a `highlight` index painted as a background class,
   * and DOM focus deliberately stays on the panel (moving it per item fights
   * the outside-click and restore-focus logic). Visually that reads fine; to a
   * screen reader it read as nothing at all — the menu announced itself as a
   * menu, arrow keys changed the picture, and no item was ever announced.
   * That is the same broken promise `role="menu"` makes when it has no arrow
   * keys, one level further in.
   */
  const menuId = useId();
  const itemId = (action: MenuAction) => `${menuId}-${action.id}`;

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
    setCoords(null);
  }, []);

  /**
   * Close, and hand focus back to the trigger — but only if the item did not
   * move focus somewhere deliberate.
   *
   * `invoke` awaits `onSelect`, so by the time this runs React has already
   * flushed whatever the item did. An item that opens an inline editor (the
   * "Edit title" pattern, where the menu focuses the page's real field rather
   * than growing its own) has therefore already focused that field. Taking
   * focus back would blur it — and since `ui/InlineText` saves on blur and a
   * no-op save closes the editor, the field opened and shut in the same frame
   * and the menu item looked like it did nothing at all.
   *
   * Focus still on the menu (or nowhere) means the item was a plain command,
   * and the trigger is the right place to land.
   */
  const closeAndRestore = useCallback(() => {
    const active = document.activeElement;
    const focusUnclaimed = active === null
      || active === document.body
      || (menuRef.current?.contains(active) ?? false);
    close();
    if (focusUnclaimed) triggerRef.current?.focus();
  }, [close]);

  /**
   * Where the panel goes, in viewport coordinates.
   *
   * `position: fixed` is viewport-relative, so these are rect values with no
   * scroll offset added — adding window.scrollY here is the bug ui/Dropdown
   * documents. Before the panel has mounted its height is an estimate, and
   * the estimate is what decides the upward flip, hence the second pass in
   * the effect below once the real height exists.
   */
  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const h = menuRef.current?.offsetHeight ?? Math.min(420, flat.length * 34 + 24);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < h + 8 && r.top > spaceBelow;
    let left = align === 'right' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    return { top: openUp ? Math.max(8, r.top - h - 6) : r.bottom + 6, left, openUp };
  }, [align, width, flat.length]);

  const reposition = useCallback(() => {
    const next = measure();
    if (next) setCoords(next);
  }, [measure]);

  // Re-measure once the panel is mounted and its real height is known. The
  // first measurement happens in the click handler, so the panel never paints
  // at a stale position and this effect never setStates synchronously.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(reposition);
    return () => cancelAnimationFrame(frame);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onScrollOrResize = () => reposition();
    document.addEventListener('mousedown', onDown);
    // Capture phase catches scrolls on inner containers (modal bodies,
    // scrollable lists) before they reach their target.
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, close, reposition]);

  const invoke = useCallback(async (action: MenuAction) => {
    if (action.disabled || action.busy) return;
    const result = await action.onSelect();
    if (result !== 'keep-open') closeAndRestore();
  }, [closeAndRestore]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeAndRestore();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => nextEnabledIndex(flat, h, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); setHighlight(firstEnabledIndex(flat)); return; }
    if (e.key === 'End')  { e.preventDefault(); setHighlight(nextEnabledIndex(flat, 0, -1)); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      if (highlight >= 0 && flat[highlight]) { e.preventDefault(); void invoke(flat[highlight]); }
      return;
    }
    // Single-letter accelerators. Ignore anything with a modifier so the
    // browser's own shortcuts still work while a menu happens to be open.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const idx = indexForShortcutKey(flat, e.key);
      if (idx >= 0) { e.preventDefault(); void invoke(flat[idx]); }
    }
  };

  const toggle = () => {
    if (open) { close(); return; }
    const next = measure();
    if (next) setCoords(next);
    setHighlight(-1);
    setOpen(true);
  };

  // A menu whose every item is hidden must not render a trigger: the button
  // would open an empty panel, which reads as a broken control rather than as
  // "nothing applies here".
  if (flat.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          triggerClassName ?? cn(
            'grid size-9 place-items-center rounded-full border transition-colors',
            open
              ? 'border-white/20 bg-white/[0.06] text-white'
              : 'border-transparent text-white/40 hover:border-white/10 hover:bg-white/[0.06] hover:text-white',
          ),
          className,
        )}
      >
        {busy
          ? <Loader2 size={13} className="animate-spin" />
          : triggerContent ?? <MoreHorizontal size={14} />}
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={
            highlight >= 0 && flat[highlight] ? itemId(flat[highlight]) : undefined
          }
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width }}
          className={cn(
            // Arrives off the edge it hangs from, so it reads as coming out of
            // the trigger. Flipped menus animate the other way for the same
            // reason.
            coords.openUp ? 'ui-pop-up' : 'ui-pop',
            'z-[200] max-h-[70vh] overflow-y-auto rounded-xl py-1.5',
            'border border-white/[0.12] bg-[#0e0c09]/95 backdrop-blur-2xl',
            'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_24px_60px_-12px_rgba(0,0,0,0.7)]',
            'focus:outline-none',
          )}
        >
          <AutoFocus target={menuRef} />
          {resolved.map((section, si) => {
            // Index into the flat list so highlight math matches what the
            // keyboard handler computed.
            const before = resolved.slice(0, si).reduce((n, s) => n + s.items.length, 0);
            return (
              <div key={section.id}>
                {si > 0 && <div className="my-1 h-px bg-white/[0.08]" />}
                {section.label && (
                  <p className="px-3 pb-1 pt-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">
                    {section.label}
                  </p>
                )}
                {section.items.map((action, ii) => {
                  const idx = before + ii;
                  return (
                    <button
                      key={action.id}
                      id={itemId(action)}
                      type="button"
                      // A row that carries a check mark is a toggle, and
                      // `menuitem` has nowhere to put that state — the mark
                      // would be visual only.
                      role={action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                      aria-checked={action.checked}
                      disabled={action.disabled || action.busy}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => void invoke(action)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium transition-colors',
                        'disabled:cursor-not-allowed disabled:opacity-40',
                        action.danger || section.danger ? 'text-red-400' : 'text-white',
                        highlight === idx && !(action.disabled || action.busy)
                          ? (action.danger || section.danger ? 'bg-red-500/10' : 'bg-white/[0.08]')
                          : '',
                      )}
                    >
                      <span className="grid size-3.5 shrink-0 place-items-center">
                        {action.busy
                          ? <Loader2 size={13} className="animate-spin" />
                          : action.checked
                            ? <Check size={13} className="text-[#6DC6A4]" />
                            : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{action.label}</span>
                        {action.hint && (
                          <span className="mt-0.5 block truncate text-[10px] font-normal text-white/40">
                            {action.hint}
                          </span>
                        )}
                      </span>
                      {action.shortcut && (
                        <span className="shrink-0 font-mono text-[10px] text-white/30">{action.shortcut}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Moves focus into the menu panel once, on mount. */
function AutoFocus({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => { target.current?.focus(); }, [target]);
  return null;
}
