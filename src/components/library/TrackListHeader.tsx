'use client';

import type { ReactNode } from 'react';
import { gridTemplate, type LibraryColumn } from '@/lib/library/columns';

interface Props<S extends string> {
  columns: LibraryColumn[];
  /** The active sort mode; a column whose `sort` equals it shows its arrow. */
  sortMode: S;
  onSort: (mode: S) => void;
  /** First cell: the library puts its select-all / store-order marker here. */
  leading?: ReactNode;
  /** Width of the last track; must match the rows' `trailingWidth`. */
  trailingWidth?: string;
}

/**
 * The column heads above a list of `TrackCard` rows. One component for the
 * Library and for the share pages, so the header and the rows can never
 * disagree about what is displayed (headers come from the configured columns).
 */
export function TrackListHeader<S extends string>({ columns, sortMode, onSort, leading, trailingWidth }: Props<S>) {
  return (
    <div
      style={{ '--track-row-cols': gridTemplate(columns, trailingWidth) } as React.CSSProperties}
      className="track-row-dynamic hidden md:grid items-center gap-4 border border-transparent px-3 h-8 text-[9px] font-mono uppercase tracking-wider"
    >
      <span className="text-center flex items-center justify-center text-white/30">{leading ?? ''}</span>
      {columns.map((col) => {
        const alignCls = col.align === 'right' ? 'flex justify-end' : 'block';
        if (!col.sort) {
          return <span key={col.id} className={`${alignCls} truncate text-white/40`}>{col.label}</span>;
        }
        const isActive = (sortMode as string) === col.sort;
        return (
          <button
            key={col.id}
            onClick={() => onSort(col.sort as S)}
            aria-label={`Sort by ${col.label}`}
            className={`flex items-center gap-1 truncate transition-colors hover:text-white ${
              col.align === 'right' ? 'justify-end' : ''
            } ${isActive ? 'text-white' : 'text-white/40'}`}
          >
            {col.label}
            <span className="text-[9px]">{isActive ? ((sortMode as string) === 'bpm-desc' ? '↓' : '↑') : ''}</span>
          </button>
        );
      })}
      <span />
    </div>
  );
}
