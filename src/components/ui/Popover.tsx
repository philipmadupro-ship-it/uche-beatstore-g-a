'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lightweight popover primitive. The existing Dropdown is select-style only
 * ({value,label} options); this hosts arbitrary trigger + content — used for
 * filter buttons with badges, bulk-edit panels, and segment menus.
 *
 * Portaled to <body> to escape overflow/stacking contexts; positioned under the
 * trigger and flipped/clamped to stay on screen. Closes on outside-click + Esc.
 */
export function Popover({
  trigger,
  children,
  align = 'left',
  width = 240,
  open: controlledOpen,
  onOpenChange,
  initialFocus = false,
  label,
}: {
  trigger: (args: { open: boolean; toggle: () => void; ref: (el: HTMLElement | null) => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Move focus into the panel when it opens, and hand it back to the trigger
   * when it closes. Needed wherever something other than the trigger opens the
   * popover — a ⋯ menu's "Edit tags", say. Without it focus stays wherever
   * the opener left it (ActionMenu gives it back to its own trigger), so a
   * keyboard user is stranded somewhere else while the panel they asked for
   * sits portaled at the end of the document. Off by default: the popovers
   * opened only by their own trigger work fine as they are.
   */
  initialFocus?: boolean;
  /** Accessible name. When set, the panel is a labelled `role="dialog"`. */
  label?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolled;
  const setOpen = (v: boolean) => { if (!isControlled) setUncontrolled(v); onOpenChange?.(v); };

  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    let left = align === 'right' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const top = Math.min(r.bottom + 6, window.innerHeight - 16);
    setPos({ top, left });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Runs once the panel exists: `pos` is null for the render in which `open`
  // first flips, and the portal only mounts after the position is measured.
  useEffect(() => {
    if (!initialFocus || !open || !pos) return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const first = panel.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel).focus();
  }, [initialFocus, open, pos]);

  // Give focus back when the panel closes, but only if it was left inside the
  // panel or dropped to <body>. If the close came from clicking into another
  // field, that field has focus now and taking it would be the same
  // focus-steal ActionMenu was fixed for.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!initialFocus) return;
    if (open) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) triggerRef.current?.focus();
  }, [initialFocus, open]);

  const close = () => setOpen(false);

  return (
    <>
      {trigger({ open, toggle: () => setOpen(!open), ref: (el) => { triggerRef.current = el; } })}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role={label ? 'dialog' : undefined}
          aria-label={label}
          tabIndex={initialFocus ? -1 : undefined}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
          /* Opaque surface. This was `bg-white/[0.02]` — 2% white over
             whatever the popover happened to cover, so every menu in the app
             rendered with the page showing straight through it and the items
             sitting on top of album art. A floating panel has to occlude what
             it floats over; the blur is the house style on top of that, not
             a substitute for a background. The mix leans on a heavy blur so
             the panel can stay genuinely translucent and still read. */
 className="z-[200] rounded-xl border border-white/[0.12] bg-[#0e0c09]/70 backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_24px_60px_-12px_rgba(0,0,0,0.7)] ui-pop py-1"
        >
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  );
}
