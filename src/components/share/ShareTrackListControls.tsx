'use client';

import { Search, X } from 'lucide-react';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import {
  parseBpmBound,
  type ShareFacets,
  type ShareControlsVisibility,
  type ShareListFilters,
  type ShareSort,
  shareCountLabel,
  activeShareFilterCount,
} from '@/lib/share/track-list';

interface Props {
  filters: ShareListFilters;
  onChange: (next: ShareListFilters) => void;
  facets: ShareFacets;
  visibility: ShareControlsVisibility;
  shown: number;
  total: number;
  /** A narrow column: the filters sit two to a row instead of one flowing line. */
  compact?: boolean;
}

const SORT_LABELS: Record<ShareSort, string> = {
  share: 'Share order',
  newest: 'Newest',
  'bpm-asc': 'BPM low to high',
  'bpm-desc': 'BPM high to low',
  title: 'Title A to Z',
};

function facetOptions(all: string, entries: { value: string; count: number }[]): DropdownOption[] {
  return [{ value: '', label: all }, ...entries.map((e) => ({ value: e.value, label: e.value, hint: String(e.count) }))];
}

const FIELD = 'min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] text-white placeholder:text-white/40 transition-colors hover:border-white/20 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/30';

/**
 * Search, filters and sort above a share's track list. Every control is a
 * native input or the app's `Dropdown`, so it works by keyboard; what appears
 * at all is decided by `shareControlsVisibility`, not here.
 */
export function ShareTrackListControls({ filters, onChange, facets, visibility, shown, total, compact }: Props) {
  const set = (patch: Partial<ShareListFilters>) => onChange({ ...filters, ...patch });
  const active = activeShareFilterCount(filters);
  const sortOptions = (Object.keys(SORT_LABELS) as ShareSort[])
    .filter((k) => k !== 'newest' || visibility.newest)
    .map((value) => ({ value, label: SORT_LABELS[value] }));

  return (
    <div data-testid="share-list-controls" role="search" aria-label="Filter tracks" className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {visibility.search && (
          <label className="relative min-w-[180px] flex-1">
            <span className="sr-only">Search tracks</span>
            <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="search"
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Escape' && filters.search) { e.preventDefault(); set({ search: '' }); } }}
              placeholder="Search tracks"
              autoComplete="off"
              className={`${FIELD} w-full pl-8`}
            />
          </label>
        )}
        {visibility.sort && (
          <Dropdown<ShareSort>
            aria-label="Sort tracks"
            label="Sort"
            value={filters.sort}
            onChange={(sort) => set({ sort })}
            options={sortOptions}
            align="right"
            className="min-w-[150px]"
          />
        )}
      </div>

      {(visibility.genre || visibility.mood || visibility.key || visibility.type || visibility.bpm) && (
        <div className={compact ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap items-center gap-2'}>
          {visibility.genre && (
            <Dropdown aria-label="Filter by genre" value={filters.genre} onChange={(genre) => set({ genre })} options={facetOptions('Genre', facets.genres)} className={compact ? 'w-full' : 'min-w-[120px]'} />
          )}
          {visibility.mood && (
            <Dropdown aria-label="Filter by mood" value={filters.mood} onChange={(mood) => set({ mood })} options={facetOptions('Mood', facets.moods)} className={compact ? 'w-full' : 'min-w-[120px]'} />
          )}
          {visibility.key && (
            <Dropdown aria-label="Filter by key" value={filters.key} onChange={(key) => set({ key })} options={facetOptions('Key', facets.keys)} className={compact ? 'w-full' : 'min-w-[100px]'} />
          )}
          {visibility.type && (
            <Dropdown aria-label="Filter by type" value={filters.type} onChange={(type) => set({ type })} options={facetOptions('Type', facets.types)} className={compact ? 'w-full' : 'min-w-[100px]'} />
          )}
          {visibility.bpm && facets.bpm && (
            <div className={`flex items-center gap-1.5 ${compact ? 'col-span-2' : ''}`} role="group" aria-label="BPM range">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                aria-label="Minimum BPM"
                placeholder="BPM min"
                value={filters.bpmMin ?? ''}
                onChange={(e) => set({ bpmMin: parseBpmBound(e.target.value) })}
                className={`${FIELD} ${compact ? 'min-w-0 flex-1' : 'w-[104px]'} tabular-nums`}
              />
              <span aria-hidden="true" className="text-white/30">–</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                aria-label="Maximum BPM"
                placeholder="BPM max"
                value={filters.bpmMax ?? ''}
                onChange={(e) => set({ bpmMax: parseBpmBound(e.target.value) })}
                className={`${FIELD} ${compact ? 'min-w-0 flex-1' : 'w-[104px]'} tabular-nums`}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
        <span data-testid="share-list-count" role="status" aria-live="polite">{shareCountLabel(shown, total)}</span>
        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, search: '', genre: '', mood: '', key: '', type: '', bpmMin: null, bpmMax: null })}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-white/60 transition-colors hover:bg-white/[0.10] hover:text-white"
          >
            <X size={11} aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
