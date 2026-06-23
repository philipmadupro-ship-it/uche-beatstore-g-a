'use client';

import { useState } from 'react';
import {
  X, ChevronDown, Sliders, RotateCcw, Heart, Download,
} from 'lucide-react';
import { Sparkles } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { TYPE_FILTERS, type TypeFilter } from './types';

/* ───────── Small atoms ───────── */

function ActiveChip({
  label, onClear, accentColor,
}: { label: string; onClear: () => void; accentColor: string }) {
  return (
    <button
      onClick={onClear}
      className="tap inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.15em] text-black transition-opacity hover:opacity-90"
      style={{ backgroundColor: accentColor }}
      aria-label={`Remove filter: ${label}`}
    >
      {label}
      <X size={9} strokeWidth={2.5} />
    </button>
  );
}

function FacetSection({
  title, count, defaultOpen = true, children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[#211F1A] first:border-t-0 pt-3 first:pt-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="tap group mb-2 flex min-h-11 w-full items-center justify-between rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090907]"
        aria-expanded={open}
      >
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#D0C3AF] group-hover:text-[#F7EBDD] transition-colors">
          {title}
          {count != null && count > 0 && (
            <span className="ml-1.5 text-[#9B9282]">({count})</span>
          )}
        </span>
        <ChevronDown
          size={11}
          className={`text-[#9B9282] transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function ShowMoreList({ items, max = 6 }: { items: React.ReactNode[]; max?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length <= max) return <>{items}</>;
  const visible = expanded ? items : items.slice(0, max);
  return (
    <>
      {visible}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="tap mt-1.5 min-h-11 self-start rounded-md px-2 text-[9px] font-mono uppercase tracking-wider text-[#9B9282] transition-colors hover:text-[#E7D7BE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090907]"
      >
        {expanded ? '− Show less' : `+ Show all ${items.length}`}
      </button>
    </>
  );
}

function PillButton({
  active, onClick, children, accentColor,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accentColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`tap min-h-11 whitespace-nowrap rounded-full border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-[background-color,border-color,color,opacity] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090907] ${active
        ? 'text-black border-[#E7D7BE]'
        : 'bg-transparent text-[#B4AA99] border-[#2B2821] hover:border-[#E7D7BE]/30 hover:text-[#D0C3AF]'
      }`}
      style={active ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
    >
      {children}
    </button>
  );
}

const SORT_LABELS: Record<string, string> = {
  newest: 'Newest first',
  popular: 'Popular first',
  'bpm-asc': 'BPM: low → high',
  'bpm-desc': 'BPM: high → low',
  'price-asc': 'Price: low → high',
  'price-desc': 'Price: high → low',
  title: 'A → Z',
};

/* ───────── Main sidebar ───────── */

type SortBy = 'newest' | 'popular' | 'bpm-asc' | 'bpm-desc' | 'price-asc' | 'price-desc' | 'title';

interface Props {
  open: boolean;
  onClose: () => void;
  genreFilter: string;
  setGenreFilter: (v: string) => void;
  keyFilter: string;
  setKeyFilter: (v: string) => void;
  bpmMin: number;
  setBpmMin: (v: number) => void;
  bpmMax: number;
  setBpmMax: (v: number) => void;
  bpmRange: { min: number; max: number };
  typeFilter: TypeFilter;
  setTypeFilter: (v: TypeFilter) => void;
  freeOnly: boolean;
  setFreeOnly: (v: boolean) => void;
  favoritesOnly: boolean;
  setFavoritesOnly: (v: boolean) => void;
  favoritesCount: number;
  newThisWeek: boolean;
  setNewThisWeek: (v: boolean) => void;
  moodFilter: string;
  setMoodFilter: (v: string) => void;
  scaleFilter: '' | 'major' | 'minor';
  setScaleFilter: (v: '' | 'major' | 'minor') => void;
  durationBucket: '' | 'short' | 'medium' | 'long';
  setDurationBucket: (v: '' | 'short' | 'medium' | 'long') => void;
  sortBy: SortBy;
  setSortBy: (v: SortBy) => void;
  priceMin: number;
  setPriceMin: (v: number) => void;
  priceMax: number;
  setPriceMax: (v: number) => void;
  priceRange: { min: number; max: number };
  totalResults: number;
  searchQuery: string;
  clearSearch: () => void;
  hasActiveFilters: boolean;
  onReset: () => void;
  availableGenres: string[];
  availableMoods: string[];
  availableKeys: string[];
  accentColor: string;
}

export function StoreSidebar(props: Props) {
  const {
    open, onClose,
    genreFilter, setGenreFilter,
    keyFilter, setKeyFilter,
    bpmMin, setBpmMin,
    bpmMax, setBpmMax, bpmRange,
    typeFilter, setTypeFilter,
    freeOnly, setFreeOnly,
    favoritesOnly, setFavoritesOnly, favoritesCount,
    newThisWeek, setNewThisWeek,
    moodFilter, setMoodFilter,
    scaleFilter, setScaleFilter,
    durationBucket, setDurationBucket,
    sortBy, setSortBy,
    priceMin, setPriceMin, priceMax, setPriceMax, priceRange,
    totalResults, searchQuery, clearSearch,
    hasActiveFilters, onReset,
    availableGenres, availableMoods, availableKeys,
    accentColor,
  } = props;

  const effectivePriceMin = priceMin === 0 ? priceRange.min : priceMin;
  const effectivePriceMax = priceMax === 99999 ? priceRange.max : priceMax;
  const priceRangeActive = effectivePriceMin > priceRange.min || effectivePriceMax < priceRange.max;

  const effectiveMin = bpmMin === 0 ? bpmRange.min : bpmMin;
  const effectiveMax = bpmMax === 999 ? bpmRange.max : bpmMax;
  const bpmRangeActive = effectiveMin > bpmRange.min || effectiveMax < bpmRange.max;

  const content = (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99]">
          <Sliders size={11} />
          Refine
          <span className="text-[#6E685B] tabular-nums">· {totalResults}</span>
        </div>
        <button
          onClick={onClose}
          className="tap grid size-11 place-items-center rounded-full text-[#837B6D] transition-colors hover:bg-[#171511] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090907] lg:hidden"
          aria-label="Close filters"
        >
          <X size={14} />
        </button>
      </div>

      <FacetSection title="Sort by" defaultOpen>
        <Dropdown
          value={sortBy}
          onChange={(v) => setSortBy(v as SortBy)}
          options={Object.entries(SORT_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          aria-label="Sort beats"
          className="w-full"
        />
      </FacetSection>

      {hasActiveFilters && (
        <div className="rounded-lg border border-[#E7D7BE]/15 bg-[#E7D7BE]/[0.04] p-2.5">
          <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#D0C3AF] mb-1.5">
            Applied
          </p>
          <div className="flex flex-wrap gap-1">
            {searchQuery.trim() && (
              <ActiveChip label={`Search: ${searchQuery.trim()}`} onClear={clearSearch} accentColor={accentColor} />
            )}
            {typeFilter !== 'all' && (
              <ActiveChip label={typeFilter} onClear={() => setTypeFilter('all')} accentColor={accentColor} />
            )}
            {genreFilter && <ActiveChip label={genreFilter} onClear={() => setGenreFilter('')} accentColor={accentColor} />}
            {moodFilter && <ActiveChip label={moodFilter} onClear={() => setMoodFilter('')} accentColor={accentColor} />}
            {keyFilter && <ActiveChip label={`Key: ${keyFilter}`} onClear={() => setKeyFilter('')} accentColor={accentColor} />}
            {scaleFilter && <ActiveChip label={scaleFilter} onClear={() => setScaleFilter('')} accentColor={accentColor} />}
            {bpmRangeActive && (
              <ActiveChip
                label={`${effectiveMin}–${effectiveMax} BPM`}
                onClear={() => { setBpmMin(bpmRange.min); setBpmMax(bpmRange.max); }}
                accentColor={accentColor}
              />
            )}
            {priceRangeActive && (
              <ActiveChip
                label={`$${effectivePriceMin}–$${effectivePriceMax}`}
                onClear={() => { setPriceMin(priceRange.min); setPriceMax(priceRange.max); }}
                accentColor={accentColor}
              />
            )}
            {durationBucket && (
              <ActiveChip
                label={durationBucket === 'short' ? '< 2min' : durationBucket === 'medium' ? '2–4min' : '4min +'}
                onClear={() => setDurationBucket('')}
                accentColor={accentColor}
              />
            )}
            {freeOnly && <ActiveChip label="Free only" onClear={() => setFreeOnly(false)} accentColor={accentColor} />}
            {favoritesOnly && <ActiveChip label="Favorites" onClear={() => setFavoritesOnly(false)} accentColor={accentColor} />}
            {newThisWeek && <ActiveChip label="New this week" onClear={() => setNewThisWeek(false)} accentColor={accentColor} />}
          </div>
          <button
            onClick={onReset}
            className="mt-2 flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#D0C3AF] hover:text-[#E7D7BE] transition-colors"
          >
            <RotateCcw size={9} /> Clear all
          </button>
        </div>
      )}

      <FacetSection title="Type">
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <PillButton accentColor={accentColor} key={f} active={typeFilter === f} onClick={() => setTypeFilter(f)}>
              {f}
            </PillButton>
          ))}
        </div>
      </FacetSection>

      {availableGenres.length > 0 && (
        <FacetSection title="Genre" count={genreFilter ? 1 : 0}>
          <div className="flex flex-wrap gap-1.5">
            <ShowMoreList
              max={8}
              items={[
                <PillButton accentColor={accentColor} key="__all" active={genreFilter === ''} onClick={() => setGenreFilter('')}>All</PillButton>,
                ...availableGenres.map((g) => (
                  <PillButton accentColor={accentColor} key={g} active={genreFilter === g} onClick={() => setGenreFilter(genreFilter === g ? '' : g)}>
                    {g}
                  </PillButton>
                )),
              ]}
            />
          </div>
        </FacetSection>
      )}

      {availableMoods.length > 0 && (
        <FacetSection title="Mood" count={moodFilter ? 1 : 0}>
          <div className="flex flex-wrap gap-1.5">
            <ShowMoreList
              max={8}
              items={[
                <PillButton accentColor={accentColor} key="__all" active={moodFilter === ''} onClick={() => setMoodFilter('')}>Any</PillButton>,
                ...availableMoods.map((m) => (
                  <PillButton accentColor={accentColor} key={m} active={moodFilter === m} onClick={() => setMoodFilter(moodFilter === m ? '' : m)}>
                    {m}
                  </PillButton>
                )),
              ]}
            />
          </div>
        </FacetSection>
      )}

      {availableKeys.length > 0 && (
        <FacetSection title="Key" count={keyFilter ? 1 : 0} defaultOpen={false}>
          <div className="flex flex-wrap gap-1.5">
            <ShowMoreList
              max={8}
              items={[
                <PillButton accentColor={accentColor} key="__all" active={keyFilter === ''} onClick={() => setKeyFilter('')}>Any</PillButton>,
                ...availableKeys.map((k) => (
                  <PillButton accentColor={accentColor} key={k} active={keyFilter === k} onClick={() => setKeyFilter(keyFilter === k ? '' : k)}>
                    {k}
                  </PillButton>
                )),
              ]}
            />
          </div>
        </FacetSection>
      )}

      <FacetSection title="Scale" count={scaleFilter ? 1 : 0} defaultOpen={false}>
        <div className="flex gap-1.5">
          {(['', 'major', 'minor'] as const).map((s) => (
            <PillButton accentColor={accentColor} key={s || 'any'} active={scaleFilter === s} onClick={() => setScaleFilter(s)}>
              {s || 'Any'}
            </PillButton>
          ))}
        </div>
      </FacetSection>

      {bpmRange.min < bpmRange.max && (
        <FacetSection title="BPM range" count={bpmRangeActive ? 1 : 0}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[8px] font-mono text-[#6E685B]">range</span>
            <span
              className="text-[11px] font-mono font-bold tabular-nums"
              style={{ color: bpmRangeActive ? accentColor : '#837B6D' }}
            >
              {effectiveMin}–{effectiveMax}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-[#6E685B] w-5 text-right shrink-0">min</span>
              <input
                type="range"
                min={bpmRange.min}
                max={bpmRange.max}
                step={1}
                value={effectiveMin}
                onChange={(e) => setBpmMin(Math.min(Number(e.target.value), effectiveMax - 1))}
                className="flex-1 h-1 rounded"
                style={{ accentColor }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-[#6E685B] w-5 text-right shrink-0">max</span>
              <input
                type="range"
                min={bpmRange.min}
                max={bpmRange.max}
                step={1}
                value={effectiveMax}
                onChange={(e) => setBpmMax(Math.max(Number(e.target.value), effectiveMin + 1))}
                className="flex-1 h-1 rounded"
                style={{ accentColor }}
              />
            </div>
          </div>
        </FacetSection>
      )}

      {priceRange.min < priceRange.max && (
        <FacetSection title="Price (lease)" count={priceRangeActive ? 1 : 0} defaultOpen={false}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[8px] font-mono text-[#6E685B]">range</span>
            <span
              className="text-[11px] font-mono font-bold tabular-nums"
              style={{ color: priceRangeActive ? accentColor : '#837B6D' }}
            >
              ${effectivePriceMin}–${effectivePriceMax}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-[#6E685B] w-5 text-right shrink-0">min</span>
              <input
                type="range"
                min={priceRange.min}
                max={priceRange.max}
                step={1}
                value={effectivePriceMin}
                onChange={(e) => setPriceMin(Math.min(Number(e.target.value), effectivePriceMax - 1))}
                className="flex-1 h-1 rounded"
                style={{ accentColor }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-[#6E685B] w-5 text-right shrink-0">max</span>
              <input
                type="range"
                min={priceRange.min}
                max={priceRange.max}
                step={1}
                value={effectivePriceMax}
                onChange={(e) => setPriceMax(Math.max(Number(e.target.value), effectivePriceMin + 1))}
                className="flex-1 h-1 rounded"
                style={{ accentColor }}
              />
            </div>
          </div>
        </FacetSection>
      )}

      <FacetSection title="Duration" count={durationBucket ? 1 : 0} defaultOpen={false}>
        <div className="flex flex-wrap gap-1.5">
          <PillButton accentColor={accentColor} active={durationBucket === ''} onClick={() => setDurationBucket('')}>Any</PillButton>
          <PillButton accentColor={accentColor} active={durationBucket === 'short'} onClick={() => setDurationBucket(durationBucket === 'short' ? '' : 'short')}>&lt; 2 min</PillButton>
          <PillButton accentColor={accentColor} active={durationBucket === 'medium'} onClick={() => setDurationBucket(durationBucket === 'medium' ? '' : 'medium')}>2–4 min</PillButton>
          <PillButton accentColor={accentColor} active={durationBucket === 'long'} onClick={() => setDurationBucket(durationBucket === 'long' ? '' : 'long')}>4 min +</PillButton>
        </div>
      </FacetSection>

      <button
        onClick={() => setFreeOnly(!freeOnly)}
        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all ${freeOnly
            ? 'bg-[#0e1f17]/60 border-[#6DC6A4]/30 text-[#6DC6A4]'
            : 'bg-transparent border-[#2B2821] text-[#B4AA99] hover:border-[#3B372F]'
          }`}
      >
        <div className="flex items-center gap-2">
          <Download size={11} />
          <span className="text-[10px] font-mono uppercase tracking-wider">Free only</span>
        </div>
        <span className={`text-[8px] font-mono uppercase ${freeOnly ? 'text-[#6DC6A4]' : 'text-[#6E685B]'}`}>
          {freeOnly ? 'ON' : 'OFF'}
        </span>
      </button>

      <button
        onClick={() => setFavoritesOnly(!favoritesOnly)}
        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all ${favoritesOnly
            ? 'border-[#D6BE7A]/40 text-[#D6BE7A] bg-[#D6BE7A]/[0.08]'
            : 'bg-transparent border-[#2B2821] text-[#B4AA99] hover:border-[#3B372F]'
          }`}
      >
        <div className="flex items-center gap-2">
          <Heart size={11} fill={favoritesOnly ? 'currentColor' : 'none'} />
          <span className="text-[10px] font-mono uppercase tracking-wider">Favorites only</span>
        </div>
        <span className={`text-[8px] font-mono uppercase tabular-nums ${favoritesOnly ? 'text-[#D6BE7A]' : 'text-[#6E685B]'}`}>
          {favoritesCount}
        </span>
      </button>

      <button
        onClick={() => setNewThisWeek(!newThisWeek)}
        className="flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all"
        style={
          newThisWeek
            ? { borderColor: `${accentColor}66`, color: accentColor, backgroundColor: `${accentColor}14` }
            : { borderColor: '#2B2821', color: '#B4AA99' }
        }
      >
        <div className="flex items-center gap-2">
          <Sparkles size={11} />
          <span className="text-[10px] font-mono uppercase tracking-wider">New this week</span>
        </div>
        <span className="text-[8px] font-mono uppercase" style={{ color: newThisWeek ? accentColor : '#6E685B' }}>
          {newThisWeek ? 'ON' : 'OFF'}
        </span>
      </button>

      <button
        onClick={onReset}
        disabled={!hasActiveFilters}
        className="flex items-center gap-1.5 justify-center px-3 py-2 rounded-lg border border-[#2B2821] text-[10px] font-mono uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#E7D7BE]/40 hover:text-[#E7D7BE] text-[#B4AA99]"
      >
        <RotateCcw size={10} />
        Reset filters
      </button>
    </div>
  );

  return (
    <>
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <div className={`lg:hidden fixed left-0 right-0 bottom-0 z-50 bg-[#11100D] border-t border-[#2B2821] rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.6)] overflow-y-auto max-h-[75vh] transition-transform duration-300 ${open ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#3B372F]" />
        </div>
        {content}
      </div>

      <div className="hidden lg:block w-56 shrink-0 sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto">
        <div className="bg-[#11100D] border border-[#2B2821] rounded-2xl overflow-hidden">
          {content}
        </div>
      </div>
    </>
  );
}

export function BeatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-[#2B2821] bg-[#171511] overflow-hidden flex flex-col">
      <div className="w-full aspect-square bg-[#211F1A] animate-pulse" />
      <div className="p-4 flex flex-col gap-3">
        <div className="h-3.5 bg-[#2B2821] rounded animate-pulse w-3/4" />
        <div className="flex gap-1">
          <div className="h-4 w-12 bg-[#211F1A] rounded animate-pulse" />
          <div className="h-4 w-10 bg-[#211F1A] rounded animate-pulse" />
        </div>
        <div className="h-9 bg-[#211F1A] rounded animate-pulse mt-1" />
        <div className="mt-auto pt-2 flex gap-2">
          <div className="flex-1 h-10 bg-[#211F1A] rounded animate-pulse" />
          <div className="flex-1 h-10 bg-[#2B2821] rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function BeatListRowSkeleton() {
  return (
    <div className="rounded-xl border border-[#211F1A] bg-[#171511]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-7 h-7 rounded-full bg-[#211F1A] animate-pulse shrink-0" />
        <div className="w-10 h-10 rounded-lg bg-[#211F1A] animate-pulse shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-3 bg-[#2B2821] rounded animate-pulse w-2/3" />
          <div className="h-2.5 bg-[#211F1A] rounded animate-pulse w-1/3" />
        </div>
        <div className="hidden md:flex gap-2 shrink-0">
          <div className="h-8 w-14 bg-[#211F1A] rounded animate-pulse" />
          <div className="h-8 w-14 bg-[#2B2821] rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}
