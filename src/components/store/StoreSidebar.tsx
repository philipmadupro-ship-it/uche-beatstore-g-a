'use client';

import { useState } from 'react';
import {
  X, ChevronDown, Sliders, RotateCcw, Heart, Download,
} from 'lucide-react';
import { Sparkles } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
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
    <div className="border-t border-white/10 first:border-t-0 pt-3 first:pt-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="tap group mb-2 flex min-h-11 w-full items-center justify-between rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        aria-expanded={open}
      >
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/80 group-hover:text-white transition-colors">
          {title}
          {count != null && count > 0 && (
            <span className="ml-1.5 text-white/40">({count})</span>
          )}
        </span>
        <ChevronDown
          size={11}
          className={`text-white/40 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
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
        className="tap mt-1.5 min-h-11 self-start rounded-md px-2 text-[9px] font-mono uppercase tracking-wider text-white/40 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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
      className={`tap min-h-11 whitespace-nowrap rounded-full border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-[background-color,border-color,color,opacity] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-black ${active
        ? 'text-black border-white/30'
        : 'bg-transparent text-white/60 border-white/10 hover:border-white/20 hover:text-white/80'
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
  const panelRef = useDialogBehavior({ open: props.open, onClose: props.onClose });
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
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60">
          <Sliders size={11} />
          Refine
          <span className="text-white/40 tabular-nums">· {totalResults}</span>
        </div>
        <button
          onClick={onClose}
          className="tap grid size-11 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-black lg:hidden"
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
        <div className="rounded-lg border border-white/20 bg-white/[0.04] p-2.5">
          <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-white/80 mb-1.5">
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
            className="mt-2 flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-white/80 hover:text-white transition-colors"
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
            <span className="text-[8px] font-mono text-white/40">range</span>
            <span
              className="text-[11px] font-mono font-bold tabular-nums"
              style={{ color: bpmRangeActive ? accentColor : 'rgba(255,255,255,0.4)' }}
            >
              {effectiveMin}–{effectiveMax}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-white/40 w-5 text-right shrink-0">min</span>
              <input
                type="range"
                aria-label="Minimum BPM"
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
              <span className="text-[8px] font-mono text-white/40 w-5 text-right shrink-0">max</span>
              <input
                type="range"
                aria-label="Maximum BPM"
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
            <span className="text-[8px] font-mono text-white/40">range</span>
            <span
              className="text-[11px] font-mono font-bold tabular-nums"
              style={{ color: priceRangeActive ? accentColor : 'rgba(255,255,255,0.4)' }}
            >
              ${effectivePriceMin}–${effectivePriceMax}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-white/40 w-5 text-right shrink-0">min</span>
              <input
                type="range"
                aria-label="Minimum lease price"
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
              <span className="text-[8px] font-mono text-white/40 w-5 text-right shrink-0">max</span>
              <input
                type="range"
                aria-label="Maximum lease price"
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
        className={`tap flex min-h-11 items-center justify-between rounded-lg border px-3 py-2.5 transition-all ${freeOnly
            ? 'bg-[#0e1f17]/60 border-[#6DC6A4]/30 text-[#6DC6A4]'
            : 'bg-transparent border-white/10 text-white/60 hover:border-white/20'
          }`}
      >
        <div className="flex items-center gap-2">
          <Download size={11} />
          <span className="text-[10px] font-mono uppercase tracking-wider">Free only</span>
        </div>
        <span className={`text-[8px] font-mono uppercase ${freeOnly ? 'text-[#6DC6A4]' : 'text-white/40'}`}>
          {freeOnly ? 'ON' : 'OFF'}
        </span>
      </button>

      <button
        onClick={() => setFavoritesOnly(!favoritesOnly)}
        className={`tap flex min-h-11 items-center justify-between rounded-lg border px-3 py-2.5 transition-all ${favoritesOnly
            ? 'border-white/20 text-black bg-white font-semibold shadow-md hover:bg-white/90'
            : 'bg-transparent border-white/10 text-white/60 hover:border-white/20'
          }`}
      >
        <div className="flex items-center gap-2">
          <Heart size={11} fill={favoritesOnly ? 'currentColor' : 'none'} />
          <span className="text-[10px] font-mono uppercase tracking-wider">Favorites only</span>
        </div>
        <span className={`text-[8px] font-mono uppercase tabular-nums ${favoritesOnly ? 'text-white' : 'text-white/40'}`}>
          {favoritesCount}
        </span>
      </button>

      <button
        onClick={() => setNewThisWeek(!newThisWeek)}
        className="tap flex min-h-11 items-center justify-between rounded-lg border px-3 py-2.5 transition-all"
        style={
          newThisWeek
            ? { borderColor: `${accentColor}66`, color: accentColor, backgroundColor: `${accentColor}14` }
            : { borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }
        }
      >
        <div className="flex items-center gap-2">
          <Sparkles size={11} />
          <span className="text-[10px] font-mono uppercase tracking-wider">New this week</span>
        </div>
        <span className="text-[8px] font-mono uppercase" style={{ color: newThisWeek ? accentColor : 'rgba(255,255,255,0.4)' }}>
          {newThisWeek ? 'ON' : 'OFF'}
        </span>
      </button>

      <button
        onClick={onReset}
        disabled={!hasActiveFilters}
        className="tap flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-white/60 transition-all hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        tabIndex={-1}
        className={`lg:hidden fixed left-0 right-0 bottom-0 z-50 bg-white/[0.02] border-t border-white/10 rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.6)] overflow-y-auto max-h-[75vh] transition-transform duration-300 focus:outline-none ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        {content}
      </div>

      <div className="hidden lg:block w-56 shrink-0 sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto">
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
          {content}
        </div>
      </div>
    </>
  );
}

export function BeatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden flex flex-col">
      <div className="w-full aspect-square bg-white/[0.05] animate-pulse" />
      <div className="p-4 flex flex-col gap-3">
        <div className="h-3.5 bg-white/20 rounded animate-pulse w-3/4" />
        <div className="flex gap-1">
          <div className="h-4 w-12 bg-white/[0.05] rounded animate-pulse" />
          <div className="h-4 w-10 bg-white/[0.05] rounded animate-pulse" />
        </div>
        <div className="h-9 bg-white/[0.05] rounded animate-pulse mt-1" />
        <div className="mt-auto pt-2 flex gap-2">
          <div className="flex-1 h-10 bg-white/[0.05] rounded animate-pulse" />
          <div className="flex-1 h-10 bg-white/20 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function BeatListRowSkeleton() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-7 h-7 rounded-full bg-white/[0.05] animate-pulse shrink-0" />
        <div className="w-10 h-10 rounded-lg bg-white/[0.05] animate-pulse shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-3 bg-white/20 rounded animate-pulse w-2/3" />
          <div className="h-2.5 bg-white/[0.05] rounded animate-pulse w-1/3" />
        </div>
        <div className="hidden md:flex gap-2 shrink-0">
          <div className="h-8 w-14 bg-white/[0.05] rounded animate-pulse" />
          <div className="h-8 w-14 bg-white/20 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}
