'use client';

import type { ReactNode } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';

interface Props {
  search: string;
  onSearch: (value: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  /** Whether any filter is narrowing the list, and how many. */
  filtersActive: boolean;
  filterCount: number;
  /** Trailing controls (columns, sort, view toggles). */
  children?: ReactNode;
}

/**
 * The secondary toolbar of the Library: a pill search, the Filters button and
 * the trailing controls. Shared with the share pages so a recipient's list is
 * searched and filtered with the same controls as the producer's own.
 */
export function LibraryToolbar({ search, onSearch, showFilters, onToggleFilters, filtersActive, filterCount, children }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6">
      <div className="relative flex-1 min-w-[160px] sm:max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          type="search"
          aria-label="Search tracks"
          placeholder="Search tracks"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-full pl-8 pr-3 py-2 text-[11px] text-white placeholder-white/40 focus:outline-none focus:border-white/[0.12] transition-colors"
        />
      </div>
      {/* Wraps below sm: an `ml-auto` group with nowrap keeps its full
          intrinsic width inside a wrapping parent, so trailing controls fall
          outside the viewport with nothing to scroll. */}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <button
          onClick={onToggleFilters}
          aria-expanded={showFilters}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-medium transition-colors ${
            showFilters || filtersActive
              ? 'bg-white/15 border border-white/40 text-white'
              : 'bg-white/[0.04] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.08]'
          }`}
        >
          <SlidersHorizontal size={11} />
          Filters
          {filtersActive && (
            <span className="w-4 h-4 rounded-full border border-white/20 text-white/70 text-[9px] font-bold flex items-center justify-center leading-none">
              {filterCount}
            </span>
          )}
        </button>
        {children}
      </div>
    </div>
  );
}
