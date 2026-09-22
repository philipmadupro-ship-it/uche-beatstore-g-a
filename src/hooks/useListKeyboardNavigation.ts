'use client';

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

import { isOwnedByAnotherControl, listKeyAction, neighbourIndices } from '@/lib/ui/list-navigation';

/**
 * Arrow-key auditioning for a list of tracks. The key rules are pure and live
 * in `lib/ui/list-navigation`; this binds them to a list element.
 *
 * Bound to the LIST, never to `window`. That is the whole arbitration with the
 * player's global shortcuts, which also use ↑/↓ (for volume): a keydown inside
 * the list reaches this handler first, and calling `preventDefault()` marks
 * the key as claimed; `usePlayerKeyboardShortcuts` checks `defaultPrevented`
 * and stands down. Outside a list, nothing claims ↑/↓ and volume keeps them.
 *
 * ## The cursor follows the ROW, not the position
 *
 * It is stored as a track id, and the index is derived from it on every
 * render. Re-sort the list and the highlight moves with the track the producer
 * was on, instead of staying at "row 7" over a different beat. Filter that
 * track out and the derived index is simply -1.
 *
 * It also means nothing ever has to be RESET when the list changes, which is
 * what keeps this free of a setState-inside-an-effect — a lint error in this
 * codebase, and lint errors block CI.
 */
/** Hoisted so a default argument is not a fresh function on every render. */
const DEFAULT_ROW_SELECTOR = (index: number) => `[data-row-index="${index}"]`;

export interface ListKeyboardNavigation {
  activeIndex: number;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useListKeyboardNavigation<T extends { id: string }>({
  items,
  onMove,
  onActivate,
  onNeighbours,
  rowSelector = DEFAULT_ROW_SELECTOR,
}: {
  items: readonly T[];
  /** A row became the cursor — typically: play it, so the list auditions. */
  onMove?: (item: T, index: number) => void;
  /** Enter on the cursor row. */
  onActivate: (item: T, index: number) => void;
  /** The rows either side of the cursor, to warm before they are asked for. */
  onNeighbours?: (neighbours: T[]) => void;
  rowSelector?: (index: number) => string;
}): ListKeyboardNavigation {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Keys can arrive faster than React renders when ↓ is held down. The handler
  // reads the cursor from this ref so a burst of keydowns each see the row the
  // previous one moved to. Written ONLY in the event handler, never during
  // render — which is what React allows.
  const activeIdRef = useRef<string | null>(null);

  const activeIndex = activeId == null ? -1 : items.findIndex((t) => t.id === activeId);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isOwnedByAnotherControl(e.target, e.key)) return;

      const from =
        activeIdRef.current == null ? -1 : items.findIndex((t) => t.id === activeIdRef.current);
      const action = listKeyAction(e.key, from, items.length);
      if (!action) return;

      // Claim the key. The player's window listener sees `defaultPrevented`
      // and does not also change the volume.
      e.preventDefault();

      const item = items[action.index];
      if (!item) return;
      activeIdRef.current = item.id;
      setActiveId(item.id);

      // Keep the cursor row on screen. `block: 'nearest'` scrolls only when it
      // has left the viewport, and the default instant behaviour means there
      // is no animation to gate on reduced motion.
      const row = e.currentTarget.querySelector(rowSelector(action.index));
      if (row && typeof (row as HTMLElement).scrollIntoView === 'function') {
        (row as HTMLElement).scrollIntoView({ block: 'nearest' });
      }

      if (action.type === 'activate') {
        onActivate(item, action.index);
        return;
      }

      onMove?.(item, action.index);
      if (onNeighbours) {
        const neighbours = neighbourIndices(action.index, items.length)
          .map((i) => items[i])
          .filter((t): t is T => t != null);
        if (neighbours.length) onNeighbours(neighbours);
      }
    },
    [items, onActivate, onMove, onNeighbours, rowSelector],
  );

  return { activeIndex, onKeyDown };
}
