'use client';

import { ChevronDown, X, Check } from 'lucide-react';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils';

const CHROMATIC_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];

// Status options including MAQ — ordered by workflow stage
const STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'maq',        label: 'MAQ',      color: 'bg-[#1f1a10] text-[#c8a47a] border-[#3d3020]/40' },
  { value: 'needs_work', label: 'WIP',      color: 'bg-[#1f1a0a] text-white border-[#3a2f1f]'   },
  { value: 'finished',   label: 'Finished', color: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]'   },
  { value: 'archived',   label: 'Archived', color: 'bg-[#0D0D0A] text-white/60 border-white/10'    },
];

export type LibraryTrackType = 'all' | 'beat' | 'instrumental' | 'song' | 'remix';

export interface LibraryFilters {
  /** Track type. Folded in from the standalone pill row so every facet that
   *  narrows the list lives in one control. */
  type: LibraryTrackType;
  /** Cached-for-offline only. Was a sixth pill sitting beside the types even
   *  though it is a different axis entirely. */
  offlineOnly: boolean;
  // Genre chips (first-class)
  genres: Set<string>;
  // State chips (first-class)
  statuses: Set<string>;
  // Advanced
  bpmMin: number | null;
  bpmMax: number | null;
  keys: Set<string>;
  scale: 'all' | 'major' | 'minor';
  rating: number | null;
}

export const DEFAULT_FILTERS: LibraryFilters = {
  type: 'all',
  offlineOnly: false,
  genres: new Set(),
  statuses: new Set(),
  bpmMin: null,
  bpmMax: null,
  keys: new Set(),
  scale: 'all',
  rating: null,
};

export function hasActiveFilters(f: LibraryFilters): boolean {
  return (
    f.type !== 'all' ||
    f.offlineOnly ||
    f.genres.size > 0 ||
    f.statuses.size > 0 ||
    f.bpmMin != null ||
    f.bpmMax != null ||
    f.keys.size > 0 ||
    f.scale !== 'all' ||
    f.rating != null
  );
}

export function activeFilterCount(f: LibraryFilters): number {
  return [
    f.type !== 'all',
    f.offlineOnly,
    f.genres.size > 0,
    f.statuses.size > 0,
    f.bpmMin != null || f.bpmMax != null,
    f.keys.size > 0,
    f.scale !== 'all',
    f.rating != null,
  ].filter(Boolean).length;
}

/** Serialize filters to a plain JSON object (Sets → arrays) for storage. */
export function serializeFilters(f: LibraryFilters): Record<string, unknown> {
  return {
    type: f.type,
    offlineOnly: f.offlineOnly,
    genres: Array.from(f.genres),
    statuses: Array.from(f.statuses),
    bpmMin: f.bpmMin,
    bpmMax: f.bpmMax,
    keys: Array.from(f.keys),
    scale: f.scale,
    rating: f.rating,
  };
}

type SerializedLibraryFilters = {
  type?: unknown;
  offlineOnly?: unknown;
  genres?: unknown;
  statuses?: unknown;
  bpmMin?: unknown;
  bpmMax?: unknown;
  keys?: unknown;
  scale?: unknown;
  rating?: unknown;
};

/** Rehydrate filters from a stored JSON object (arrays → Sets). */
export function deserializeFilters(raw: unknown): LibraryFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as SerializedLibraryFilters;
  const TYPES: LibraryTrackType[] = ['all', 'beat', 'instrumental', 'song', 'remix'];
  return {
    type: TYPES.includes(r.type as LibraryTrackType) ? (r.type as LibraryTrackType) : 'all',
    offlineOnly: r.offlineOnly === true,
    genres: new Set<string>(Array.isArray(r.genres) ? r.genres : []),
    statuses: new Set<string>(Array.isArray(r.statuses) ? r.statuses : []),
    bpmMin: typeof r.bpmMin === 'number' ? r.bpmMin : null,
    bpmMax: typeof r.bpmMax === 'number' ? r.bpmMax : null,
    keys: new Set<string>(Array.isArray(r.keys) ? r.keys : []),
    scale: r.scale === 'major' || r.scale === 'minor' ? r.scale : 'all',
    rating: typeof r.rating === 'number' ? r.rating : null,
  };
}

interface FilterBarProps {
  filters: LibraryFilters;
  onChange: (f: LibraryFilters) => void;
  embedded?: boolean;
}

const TYPE_OPTIONS: Array<{ value: LibraryTrackType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'beat', label: 'Beats' },
  { value: 'instrumental', label: 'Instrumentals' },
  { value: 'song', label: 'Songs' },
  { value: 'remix', label: 'Remixes' },
];

export function FilterBar({ filters, onChange, embedded = false }: FilterBarProps) {
  const set = (partial: Partial<LibraryFilters>) => onChange({ ...filters, ...partial });

  const toggleIn = (key: 'genres' | 'statuses' | 'keys', value: string) => {
    const next = new Set(filters[key]);
    if (next.has(value)) next.delete(value); else next.add(value);
    set({ [key]: next } as Partial<LibraryFilters>);
  };
  const toggleGenre  = (g: string) => toggleIn('genres', g);
  const toggleStatus = (v: string) => toggleIn('statuses', v);
  const toggleKey    = (k: string) => toggleIn('keys', k);

  const advancedCount = [
    filters.bpmMin != null || filters.bpmMax != null,
    filters.keys.size > 0,
    filters.scale !== 'all',
    filters.rating != null,
  ].filter(Boolean).length;

  const typeLabel = TYPE_OPTIONS.find((t) => t.value === filters.type)?.label ?? 'All';

  /* Each facet is a menu, not a permanently-open row of chips.
     The old bar stacked Type, Genre and State as three wrapping chip rows plus
     an Advanced disclosure — roughly 200px of chrome above the list, always,
     even when nothing was filtered. Everything below collapses to one line and
     opens on demand. */
  const facets = (
    <>
      <FacetMenu label="Type" value={filters.type === 'all' ? null : typeLabel}>
        {(close) => (
          <MenuList>
            {TYPE_OPTIONS.map(({ value, label }) => (
              <MenuItem
                key={value}
                label={label}
                selected={filters.type === value}
                onClick={() => { set({ type: value }); close(); }}
              />
            ))}
          </MenuList>
        )}
      </FacetMenu>

      <FacetMenu label="Genre" count={filters.genres.size}>
        {() => (
          <MenuList>
            {TAG_TAXONOMY.genre.map((g) => (
              <MenuItem key={g} label={g} selected={filters.genres.has(g)} onClick={() => toggleGenre(g)} />
            ))}
          </MenuList>
        )}
      </FacetMenu>

      <FacetMenu label="State" count={filters.statuses.size}>
        {() => (
          <MenuList>
            {STATUS_OPTIONS.map(({ value, label }) => (
              <MenuItem key={value} label={label} selected={filters.statuses.has(value)} onClick={() => toggleStatus(value)} />
            ))}
          </MenuList>
        )}
      </FacetMenu>

      <FacetMenu label="Advanced" count={advancedCount} width={288}>
        {() => (
          <div className="space-y-3 p-3">
            <div>
              <FacetLabel>BPM range</FacetLabel>
              <div className="flex items-center gap-2">
                <input
                  type="number" placeholder="Min" min={0} max={999} aria-label="Minimum BPM"
                  value={filters.bpmMin ?? ''}
                  onChange={(e) => set({ bpmMin: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] tabular-nums text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
                />
                <span className="shrink-0 text-[10px] text-white/30">–</span>
                <input
                  type="number" placeholder="Max" min={0} max={999} aria-label="Maximum BPM"
                  value={filters.bpmMax ?? ''}
                  onChange={(e) => set({ bpmMax: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] tabular-nums text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <FacetLabel>Scale</FacetLabel>
              <div className="flex gap-1.5">
                {(['all', 'major', 'minor'] as const).map((sc) => (
                  <button
                    key={sc}
                    onClick={() => set({ scale: sc })}
                    aria-pressed={filters.scale === sc}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-medium capitalize transition-colors ${
                      filters.scale === sc
                        ? 'border border-[#3d3020]/60 bg-[#1f1a10] text-[#c8a47a]'
                        : 'border border-white/10 bg-white/[0.04] text-white/60 hover:text-white/80'
                    }`}
                  >{sc === 'all' ? 'Any' : sc}</button>
                ))}
              </div>
            </div>

            <div>
              <FacetLabel>Min rating</FacetLabel>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => set({ rating: filters.rating === star ? null : star })}
                    aria-label={`Minimum rating ${star} star${star === 1 ? '' : 's'}`}
                    aria-pressed={filters.rating != null && star <= filters.rating}
                    className={`grid size-7 place-items-center rounded-lg text-[14px] transition-colors ${
                      filters.rating != null && star <= filters.rating ? 'text-white' : 'text-white/30 hover:text-white/60'
                    }`}
                  >★</button>
                ))}
              </div>
            </div>

            <div>
              <FacetLabel>Key</FacetLabel>
              <div className="flex flex-wrap gap-1.5">
                {CHROMATIC_KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => toggleKey(k)}
                    aria-pressed={filters.keys.has(k)}
                    className={`size-8 rounded-lg font-mono text-[11px] font-bold transition-all ${
                      filters.keys.has(k)
                        ? 'border border-white/20 bg-white/10 text-white'
                        : 'border border-white/10 bg-white/[0.04] text-white/40 hover:border-white/20 hover:text-white/80'
                    }`}
                  >{k}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </FacetMenu>

      <button
        onClick={() => set({ offlineOnly: !filters.offlineOnly })}
        aria-pressed={filters.offlineOnly}
        className={`tap min-h-8 rounded-full border px-3 py-1 text-[11px] font-medium backdrop-blur-md transition-colors ${
          filters.offlineOnly
            ? 'border-white/25 bg-white/[0.13] text-white'
            : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:text-white/80'
        }`}
      >Offline</button>
    </>
  );

  return (
    <div className={cn(
      'animate-in fade-in slide-in-from-top-2 duration-200',
      embedded ? 'space-y-3 pb-2' : 'mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-3',
    )}>
      <div className="flex flex-wrap items-center gap-1.5">{facets}</div>

      {/* Active filters stay visible — a hidden facet menu must never leave the
          list quietly filtered with no on-screen explanation. */}
      {hasActiveFilters(filters) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-white/40">Active:</span>
          {filters.type !== 'all' && <Chip label={typeLabel} onRemove={() => set({ type: 'all' })} />}
          {filters.offlineOnly && <Chip label="Offline" onRemove={() => set({ offlineOnly: false })} />}
          {Array.from(filters.genres).map((g) => <Chip key={g} label={g} onRemove={() => toggleGenre(g)} />)}
          {Array.from(filters.statuses).map((v) => {
            const opt = STATUS_OPTIONS.find((o) => o.value === v);
            return <Chip key={v} label={opt?.label ?? v} onRemove={() => toggleStatus(v)} />;
          })}
          {(filters.bpmMin != null || filters.bpmMax != null) && (
            <Chip label={`BPM ${filters.bpmMin ?? '?'}–${filters.bpmMax ?? '?'}`} onRemove={() => set({ bpmMin: null, bpmMax: null })} />
          )}
          {filters.scale !== 'all' && <Chip label={filters.scale} onRemove={() => set({ scale: 'all' })} />}
          {Array.from(filters.keys).map((k) => <Chip key={k} label={k} onRemove={() => toggleKey(k)} />)}
          {filters.rating != null && <Chip label={`★ ≥ ${filters.rating}`} onRemove={() => set({ rating: null })} />}
          <button
            onClick={() => onChange({ ...DEFAULT_FILTERS, genres: new Set(), statuses: new Set(), keys: new Set() })}
            className="ml-1 font-mono text-[9px] text-white/60 transition-colors hover:text-white"
          >Clear all</button>
        </div>
      )}
    </div>
  );
}

/** One collapsed facet: a glass pill that opens its options in a popover. */
function FacetMenu({
  label, count, value, width = 224, children,
}: {
  label: string;
  /** Number of selections, shown as a badge. */
  count?: number;
  /** Single-select facets show the chosen value instead of a count. */
  value?: string | null;
  width?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const active = (count ?? 0) > 0 || !!value;
  return (
    <Popover
      width={width}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="true"
          className={`tap inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium backdrop-blur-md transition-colors ${
            active || open
              ? 'border-white/25 bg-white/[0.13] text-white'
              : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:text-white/80'
          }`}
        >
          {label}
          {value && <span className="text-white/70">· {value}</span>}
          {!value && (count ?? 0) > 0 && (
            <span className="grid size-4 place-items-center rounded-full bg-white/20 text-[9px] font-bold tabular-nums text-white">
              {count}
            </span>
          )}
          <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {(close) => children(close)}
    </Popover>
  );
}

function MenuList({ children }: { children: React.ReactNode }) {
  return <div className="max-h-[min(60vh,320px)] overflow-y-auto p-1">{children}</div>;
}

function MenuItem({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="menuitemcheckbox"
      aria-checked={selected}
      className="tap flex w-full min-h-9 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[12px] text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
    >
      <span className="truncate">{label}</span>
      {selected && <Check size={12} className="shrink-0 text-[var(--accent)]" />}
    </button>
  );
}

function FacetLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{children}</p>;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white/[0.05] border border-white/20 rounded-full pl-2.5 pr-1.5 py-1 text-[10px] text-white font-mono">
      {label}
      <button onClick={onRemove} className="text-white/60 hover:text-white transition-colors leading-none">
        <X size={9} />
      </button>
    </span>
  );
}
