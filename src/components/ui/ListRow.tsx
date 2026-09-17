'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * Generalized list-row system, derived from the store's BeatListRow /
 * StoreListView pattern (the strongest list UI in the app). Dashboard
 * pages adopt this; the store keeps its own specialized components.
 *
 * Anatomy (flex, slot-based):
 *   [leading] [media] [title + meta (flex-1, truncates)] [columns (md+)] [trailing]
 *
 * Title visibility beats secondary metadata: the title block is the only
 * flexible region, everything else is shrink-0, and metadata columns hide
 * below md before the title ever loses room.
 */

interface ListContainerProps {
  children: ReactNode;
  /** Optional header row content (hidden on mobile). */
  header?: ReactNode;
  className?: string;
}

export function ListContainer({ children, header, className }: ListContainerProps) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]', className)}>
      {header && (
        <div className="hidden border-b border-white/10 bg-white/[0.02] px-4 py-2.5 md:flex md:items-center md:gap-3">
          {header}
        </div>
      )}
      <div className="divide-y divide-white/10">{children}</div>
    </div>
  );
}

interface ListRowProps {
  /**
   * Accessible name for the row's own activation target. Required in practice
   * whenever `href`/`onClick` is set, because the activator is an overlay with
   * no text of its own.
   */
  label?: string;
  /**
   * Set when the title slot contains its own control — an inline rename field,
   * say. The title then takes its own clicks instead of passing them to the
   * row.
   */
  titleInteractive?: boolean;
  /** Leading control — play button, checkbox, index number. shrink-0. */
  leading?: ReactNode;
  /** Cover art / avatar. shrink-0. */
  media?: ReactNode;
  title: ReactNode;
  /** Quiet line under the title. */
  meta?: ReactNode;
  /** Metadata columns, hidden below md (BPM, key, date…). Each child should size itself. */
  columns?: ReactNode;
  /** Trailing actions — buttons, menus. shrink-0, stops propagation. */
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  /** Highlighted state (currently playing / selected). */
  active?: boolean;
  className?: string;
}

export function ListRow({
  label,
  titleInteractive,
  leading,
  media,
  title,
  meta,
  columns,
  trailing,
  href,
  onClick,
  active,
  className,
}: ListRowProps) {
  /**
   * The row's own click target is an OVERLAY, not the row element.
   *
   * This used to render the whole row as a `<button>` (or `<Link>`) wrapping
   * every slot, so anything interactive inside it was nested inside a button:
   * the trailing "open in new tab" anchor always was, and adding an inline
   * rename field and a ⋯ menu to the title made it three. `<button>` inside
   * `<button>` is invalid HTML — React reports it as a hydration error and the
   * inner control's behaviour is up to the browser.
   *
   * So the row is a plain element, the activator is stretched across it
   * underneath the content, and only the slots that hold controls take pointer
   * events. Empty space and the metadata line still activate the row.
   */
  const inner = (
    <div className="pointer-events-none relative z-10 flex w-full items-center gap-3">
      {leading && <div className="pointer-events-auto shrink-0">{leading}</div>}
      {media && <div className="shrink-0">{media}</div>}
      <div className={cn('min-w-0 flex-1', titleInteractive && 'pointer-events-auto')}>
        <div className="truncate text-row-title">{title}</div>
        {meta && <div className="mt-0.5 truncate text-meta">{meta}</div>}
      </div>
      {columns && <div className="hidden shrink-0 items-center gap-4 md:flex">{columns}</div>}
      {trailing && (
        <div
          className="pointer-events-auto flex shrink-0 items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {trailing}
        </div>
      )}
    </div>
  );

  const rowClass = cn(
    'group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors sm:px-4',
    active ? 'bg-[#0D0D0A]' : 'hover:bg-[#0D0D0A]/60',
    className,
  );

  // Stretched activator. `rounded-inherit` keeps the focus ring on the row's
  // own shape rather than a rectangle over a rounded container.
  const overlayClass = 'absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';

  if (href) {
    return (
      <div className={rowClass}>
        <Link href={href} onClick={onClick} aria-label={label} className={overlayClass} />
        {inner}
      </div>
    );
  }

  if (onClick) {
    return (
      <div className={rowClass}>
        <button type="button" onClick={onClick} aria-label={label} className={overlayClass} />
        {inner}
      </div>
    );
  }

  return <div className={rowClass}>{inner}</div>;
}
