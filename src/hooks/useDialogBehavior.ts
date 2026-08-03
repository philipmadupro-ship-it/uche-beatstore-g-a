'use client';

/**
 * Dialog behaviour for overlays that are not built on `ui/Modal`.
 *
 * `ui/Modal` and `ui/Drawer` already do all of this correctly. But the codebase
 * has ~29 hand-rolled `fixed inset-0` overlays that predate them, and rewriting
 * each one to use the primitive is a large behavioural change with real risk of
 * regressions. This gives them the three things they are actually missing —
 * Escape, a focus trap, and focus restoration — in three lines, without
 * touching their markup or layout.
 *
 * Prefer `ui/Modal` for anything new. This is for retrofitting what exists.
 *
 * NOT for dropdowns or context menus. Those are `role="menu"`, should close on
 * blur and Escape but must NOT trap focus — trapping in a menu strands keyboard
 * users inside a popup they expected to tab out of.
 *
 * WHY EACH PIECE MATTERS
 *
 *   - Escape: without it a keyboard user who opens a dialog by accident has no
 *     way out that does not involve tabbing to a close button they cannot see.
 *   - Focus trap: without it Tab walks out of the dialog and into the page
 *     behind, which is still rendered. The user is then editing a form they
 *     cannot see while a modal covers the screen.
 *   - Focus restore: without it focus falls back to <body> on close, so the
 *     next Tab starts from the top of the page rather than where they were.
 */

import { useEffect, useRef } from 'react';

/** Elements that can hold focus. Matches the selector used by `ui/Modal`. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface Options {
  /** Whether the overlay is currently shown. */
  open: boolean;
  /** Called on Escape and used as the dialog's dismiss path. */
  onClose: () => void;
  /** Set false for overlays that must not trap focus (menus, popovers). */
  trapFocus?: boolean;
}

/**
 * Returns a ref to attach to the dialog panel.
 *
 * ```tsx
 * const panelRef = useDialogBehavior({ open, onClose });
 * <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Share">
 * ```
 */
export function useDialogBehavior<T extends HTMLElement = HTMLDivElement>({
  open, onClose, trapFocus = true,
}: Options) {
  const panelRef = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember where focus came from so it can be handed back on close.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Captured once for the cleanup below: by the time cleanup runs, React may
    // already have detached the node and `panelRef.current` can be null, which
    // would silently skip focus restoration.
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      // Focus the panel itself when it holds nothing focusable, so the dialog
      // is still announced rather than leaving focus on the page behind it.
      (first ?? panel).focus?.();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (!trapFocus || event.key !== 'Tab') return;

      const current = panelRef.current;
      if (!current) return;
      // No visibility filter here. The obvious one — `offsetParent !== null` —
      // is WRONG for this use: `offsetParent` is null for any
      // `position: fixed` element, which is precisely what a modal panel is, so
      // it would have excluded every real control in the dialog. The selector
      // already excludes `[disabled]` and `tabindex="-1"`; a stray hidden
      // control in the cycle is a far smaller problem than a trap that skips
      // the actual buttons.
      const focusable = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE));

      if (focusable.length === 0) {
        event.preventDefault();
        current.focus?.();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Restore focus, but only if it is still somewhere in this dialog —
      // if the user has already clicked elsewhere, yanking focus back would be
      // more disruptive than leaving it.
      const active = document.activeElement;
      const inPanel = panel?.contains(active as Node) ?? false;
      if (inPanel || active === document.body) previousFocusRef.current?.focus?.();
    };
  }, [open, onClose, trapFocus]);

  return panelRef;
}
