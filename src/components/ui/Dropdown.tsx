'use client';

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional inline group separator before this item. */
  separator?: boolean;
  /** Optional muted hint shown after the label. */
  hint?: string;
}

interface Props<T extends string = string> {
  value: T;
  onChange: (v: T) => void;
  options: DropdownOption<T>[];
  /** Static label shown before the value (e.g. "Sort:"). */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Width of the menu in pixels — defaults to matching the trigger. */
  menuWidth?: number;
  /** Right-align the popout. Default left. */
  align?: 'left' | 'right';
  'aria-label'?: string;
}

/**
 * Hand-rolled dropdown. Portaled to <body> so it escapes any parent
 * stacking context (modal backdrop-blur, sticky toolbars, transforms).
 *
 * Positioning is THE thing that goes wrong here, so we're explicit
 * about every case:
 *
 *  - Menu uses `position: fixed`, which is VIEWPORT-relative. The
 *    coords come straight from getBoundingClientRect — DO NOT add
 *    window.scrollY/X to them. (That was the bug in PR #11.)
 *  - We flip upward when there's less room below than the menu's
 *    rendered height, so a Dropdown near the bottom of the viewport
 *    doesn't get clipped.
 *  - We listen for scroll in CAPTURE phase on window, which catches
 *    scroll events firing on any inner container (modals with
 *    overflow-y-auto bodies, scrollable lists, etc.) before they
 *    reach their target.
 *  - We use ResizeObserver on the trigger so layout shifts inside
 *    the parent (a flex grow, a sibling collapse) reposition the
 *    menu too. Same reason for the resize listener on window.
 */
export function Dropdown<T extends string = string>({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select',
  disabled,
  className,
  menuWidth,
  align = 'left',
  'aria-label': ariaLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);

  const selected = options.find((o) => o.value === value);
  const display = selected?.label ?? placeholder;

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Estimate menu height from option count when we don't have a
    // rendered ref yet (first paint). 30px per option + 8px padding
    // is conservative — actual menu uses py-1.5 per row.
    const menuHeight = menuRef.current?.offsetHeight ?? Math.min(280, options.length * 30 + 8);
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow;
    setCoords({
      top: openUp ? Math.max(8, r.top - menuHeight - 4) : r.bottom + 4,
      left: align === 'right' ? r.right - (menuWidth ?? r.width) : r.left,
      width: menuWidth ?? r.width,
      openUp,
    });
  }, [align, menuWidth, options.length]);

  // useLayoutEffect on open so the first paint of the menu is
  // already correctly positioned (no flicker frame at top-left).
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    setHighlight(options.findIndex((o) => o.value === value));
  }, [open, options, value, reposition]);

  // After the menu mounts and we know its real height, recompute
  // once so the openUp decision uses the actual height instead of
  // the estimate.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => reposition());
  }, [open, reposition]);

  // Outside click, ESC, arrow keys, scroll, resize, ResizeObserver.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(options.length - 1, h + 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
      else if (e.key === 'Enter')     {
        e.preventDefault();
        if (highlight >= 0 && highlight < options.length) {
          onChange(options[highlight].value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // Capture-phase scroll listener catches inner-container scrolls
    // (modal bodies, scrollable lists) before they hit the target.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    // ResizeObserver on the trigger picks up layout shifts that
    // don't involve scroll/resize — e.g. parent flex changes, a
    // sibling collapses, the modal header animates in.
    const ro = triggerRef.current ? new ResizeObserver(reposition) : null;
    if (ro && triggerRef.current) ro.observe(triggerRef.current);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      ro?.disconnect();
    };
  }, [open, options, highlight, onChange, reposition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center justify-between gap-2 px-3 py-2 rounded-md',
          'bg-[#171511] border border-[#211F1A] text-[11px] text-[#F7EBDD]',
          'hover:border-[#3B372F] transition-colors',
          'focus:outline-none focus:border-[#E7D7BE]/40 focus:ring-1 focus:ring-[#E7D7BE]/20',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          open && 'border-[#3B372F]',
          className,
        )}
      >
        {label && <span className="text-[#B4AA99] font-mono uppercase tracking-wider text-[10px]">{label}</span>}
        <span className="flex-1 text-left truncate">{display}</span>
        <ChevronDown size={11} className={cn('text-[#B4AA99] transition-transform shrink-0', open && 'rotate-180')} />
      </button>

      {/* Portaled menu. Top-level z-200 keeps it above modals
          (z-100) and toasters (z-150). */}
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          className={cn(
            'fixed z-[200] py-1 rounded-lg overflow-y-auto max-h-[60vh]',
            'bg-[#090907]/95 backdrop-blur-xl border border-white/[0.08]',
            'shadow-[0_4px_24px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)_inset]',
            'animate-in fade-in zoom-in-95 duration-100',
          )}
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            minWidth: 160,
            // Anchor the zoom-in animation to the side the menu
            // expanded from so it grows AWAY from the trigger.
            transformOrigin: coords.openUp ? 'bottom left' : 'top left',
          }}
        >
          {options.map((opt, i) => (
            <div key={opt.value}>
              {opt.separator && <div className="my-1 h-px bg-white/[0.06] mx-2" />}
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => { onChange(opt.value); setOpen(false); triggerRef.current?.focus(); }}
                className={cn(
                  'w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-[#F7EBDD]',
                  'transition-colors',
                  highlight === i ? 'bg-white/[0.04]' : '',
                )}
              >
                <span className="w-3.5 flex items-center justify-center">
                  {opt.value === value && <Check size={11} className="text-[#F3E6D1]" />}
                </span>
                <span className="flex-1 truncate">{opt.label}</span>
                {opt.hint && <span className="text-[10px] text-[#9B9282] font-mono">{opt.hint}</span>}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
