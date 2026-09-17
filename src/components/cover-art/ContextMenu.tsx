'use client';

/**
 * Right-click menu for the canvas and the layer list.
 *
 * Rendered in a fixed-position layer at viewport coordinates. Per the project's
 * gotchas: bounding-rect coords are already viewport-relative, so `window.scrollY`
 * must NOT be added here.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { firstEnabledIndex, nextEnabledIndex, type MenuAction } from '@/lib/ui/action-menu';

export type ContextMenuItem =
  | { kind: 'separator' }
  | {
    kind: 'action';
    label: string;
    shortcut?: string;
    disabled?: boolean;
    danger?: boolean;
    onSelect: () => void;
  };

export function ContextMenu({
  x, y, items, onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [highlight, setHighlight] = useState(-1);

  /**
   * Ids for `aria-activedescendant`. Focus stays on the panel and the cursor
   * is a painted highlight, so without these the arrow keys move something a
   * screen reader cannot see — same gap `ui/ActionMenu` had.
   */
  const menuId = useId();
  const itemId = (index: number) => `${menuId}-item-${index}`;

  /**
   * The actionable rows, in render order.
   *
   * Separators carry no identity and must not take a keyboard index —
   * arrowing onto one would look like the highlight vanishing. Shaped as
   * `MenuAction` so the arrow-key maths is the same tested function
   * `ui/ActionMenu` uses rather than a second copy of the wrapping and
   * skip-disabled rules.
   */
  const actions = useMemo<MenuAction[]>(
    () => items
      .filter((i): i is Extract<ContextMenuItem, { kind: 'action' }> => i.kind === 'action')
      .map((i, idx) => ({ id: `${i.label}-${idx}`, label: i.label, disabled: i.disabled, onSelect: i.onSelect })),
    [items],
  );

  /**
   * Nudge the menu back on screen if it would overflow.
   *
   * Layout effect so the correction happens before paint — a menu that appears
   * half off the edge and then jumps reads as a glitch.
   */
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    // This is the sanctioned use of useLayoutEffect: measure the rendered box
    // and correct its position before the browser paints, so an edge-clamped
    // menu never visibly jumps. The lint rule below targets effects that
    // cascade into further renders; this one settles in the same frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition({
      x: Math.min(x, window.innerWidth - box.width - 8),
      y: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  // Focus the panel so it is reachable at all from the keyboard. Without
  // this the menu announced itself as a menu and then took no key but Escape.
  useEffect(() => { ref.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // Capture phase: close before the click can land on whatever is underneath.
    const onDown = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Layer actions"
      aria-activedescendant={highlight >= 0 ? itemId(highlight) : undefined}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setHighlight((h) => nextEnabledIndex(actions, h, event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Home') {
          event.preventDefault();
          setHighlight(firstEnabledIndex(actions));
        } else if (event.key === 'End') {
          event.preventDefault();
          setHighlight(nextEnabledIndex(actions, 0, -1));
        } else if (event.key === 'Enter' || event.key === ' ') {
          const action = actions[highlight];
          if (!action) return;
          event.preventDefault();
          action.onSelect();
          onClose();
        }
      }}
      style={{ left: position.x, top: position.y }}
      className="fixed z-[1001] min-w-48 border border-white/20 bg-[#0D0D0A] py-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)] focus:outline-none"
      // The menu owns its own clicks; the capture-phase closer above would
      // otherwise dismiss it before an item could fire.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {(() => { let actionIndex = -1; return items.map((item, index) => (
        item.kind === 'separator' ? (
          <span key={`sep-${index}`} role="separator" className="my-1 block h-px bg-white/10" />
        ) : (
          ((): React.ReactNode => {
            actionIndex += 1;
            const myIndex = actionIndex;
            const active = highlight === myIndex && !item.disabled;
            return (
          <button
            key={item.label}
            id={itemId(myIndex)}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onMouseEnter={() => setHighlight(myIndex)}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={cn(
              'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] transition-colors disabled:opacity-30',
              item.danger ? 'text-white/90 hover:bg-[#A95235]/20' : 'text-white/60 hover:bg-white/[0.10] hover:text-white/90',
              active && (item.danger ? 'bg-[#A95235]/20' : 'bg-white/[0.10] text-white/90'),
              'disabled:hover:bg-transparent',
            )}
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <span className="shrink-0 font-mono text-[10px] text-white/40">{item.shortcut}</span>
            ) : null}
          </button>
            );
          })()
        )
      )); })()}
    </div>
  );
}
