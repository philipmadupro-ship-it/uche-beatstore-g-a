'use client';

import { Drawer } from './Drawer';
import { Button } from './Button';
import type { ReactNode } from 'react';

/**
 * Mobile filter bottom sheet — thin wrapper over Drawer side='bottom'.
 *
 * Replaces page-expanding inline filter panels below `lg`: filters
 * overlay the content instead of pushing it down. Desktop keeps
 * whatever inline/popover UI the page already has; callers gate this
 * with `lg:hidden` on the trigger.
 *
 * The sheet is uncontrolled with respect to filter state — callers keep
 * their existing filter state and just render the same controls inside.
 */
interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Clears all filters. Button disabled when `canReset` is false. */
  onReset?: () => void;
  canReset?: boolean;
  /** Label for the apply/close button, e.g. "Show 12 results". */
  applyLabel?: string;
}

export function FilterSheet({
  open,
  onClose,
  title = 'Filters',
  children,
  onReset,
  canReset = true,
  applyLabel = 'Done',
}: FilterSheetProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      side="bottom"
      showHeader={false}
      contentClassName="px-4 pb-2 pt-1"
      footer={
        <div className="flex items-center gap-3">
          {onReset && (
            <Button variant="ghost" size="sm" onClick={onReset} disabled={!canReset}>
              Reset
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={onClose} className="ml-auto">
            {applyLabel}
          </Button>
        </div>
      }
    >
      {/* Drag handle */}
      <div className="flex justify-center pb-2 pt-1">
        <div className="h-1 w-10 rounded-full bg-[#3B372F]" />
      </div>
      <p className="text-eyebrow mb-3">{title}</p>
      {children}
    </Drawer>
  );
}
