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
    <div className={cn('overflow-hidden rounded-2xl border border-[#211F1A] bg-[#171511]/70', className)}>
      {header && (
        <div className="hidden border-b border-[#211F1A] bg-[#11100D] px-4 py-2.5 md:flex md:items-center md:gap-3">
          {header}
        </div>
      )}
      <div className="divide-y divide-[#211F1A]">{children}</div>
    </div>
  );
}

interface ListRowProps {
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
  const inner = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      {media && <div className="shrink-0">{media}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-row-title">{title}</div>
        {meta && <div className="mt-0.5 truncate text-meta">{meta}</div>}
      </div>
      {columns && <div className="hidden shrink-0 items-center gap-4 md:flex">{columns}</div>}
      {trailing && (
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {trailing}
        </div>
      )}
    </>
  );

  const rowClass = cn(
    'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors sm:px-4',
    active ? 'bg-[#1A1813]' : 'hover:bg-[#1A1813]/60',
    className,
  );

  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cn(rowClass, 'group')}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(rowClass, 'group')}>
        {inner}
      </button>
    );
  }

  return <div className={cn(rowClass, 'group')}>{inner}</div>;
}
