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
}: {
  trigger: (args: { open: boolean; toggle: () => void; ref: (el: HTMLElement | null) => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

  const close = () => setOpen(false);

  return (
    <>
      {trigger({ open, toggle: () => setOpen(!open), ref: (el) => { triggerRef.current = el; } })}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
          className="z-[200] rounded-xl border border-[var(--border)] bg-[#11100D] shadow-2xl animate-in fade-in slide-in-from-top-1 py-1"
        >
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  );
}
