'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { TAG_TAXONOMY } from '@/lib/types/tags';
import { cn } from '@/lib/utils';

const CHROMATIC_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];

// Status options including MAQ — ordered by workflow stage
const STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'maq',        label: 'MAQ',      color: 'bg-[#1a1033] text-[#b39ddb] border-[#534AB7]/40' },
  { value: 'needs_work', label: 'WIP',      color: 'bg-[#1f1a0a] text-[#D6BE7A] border-[#3a2f1f]'   },
  { value: 'finished',   label: 'Finished', color: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]'   },
  { value: 'archived',   label: 'Archived', color: 'bg-[#1A1813] text-[#B4AA99] border-[#2B2821]'    },
];

export interface LibraryFilters {
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
  return {
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

export function FilterBar({ filters, onChange, embedded = false }: FilterBarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = (partial: Partial<LibraryFilters>) => onChange({ ...filters, ...partial });

  const toggleGenre = (g: string) => {
    const next = new Set(filters.genres);
    if (next.has(g)) next.delete(g); else next.add(g);
    set({ genres: next });
  };

  const toggleStatus = (s: string) => {
    const next = new Set(filters.statuses);
    if (next.has(s)) next.delete(s); else next.add(s);
    set({ statuses: next });
  };

  const toggleKey = (k: string) => {
    const next = new Set(filters.keys);
    if (next.has(k)) next.delete(k); else next.add(k);
    set({ keys: next });
  };

  return (
    <div className={cn(
      'space-y-4 animate-in fade-in slide-in-from-top-2 duration-200',
      embedded ? 'pb-2' : 'bg-[#11100D] border border-[#211F1A] rounded-xl p-4 mb-4',
    )}>

      {/* ── Genre (first-class) ─────────────────────────────────── */}
      <div>
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">Genre</p>
        <div className="flex flex-wrap gap-1.5">
          {TAG_TAXONOMY.genre.map((g) => {
            const active = filters.genres.has(g);
            return (
              <button
                key={g}
                onClick={() => toggleGenre(g)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  active
                    ? 'bg-[#E7D7BE] text-black border-[#E7D7BE]'
                    : 'bg-[#171511] border-[#2B2821] text-[#B4AA99] hover:text-[#D0C3AF] hover:border-[#3B372F]'
                }`}
              >{g}</button>
            );
          })}
        </div>
      </div>

      {/* ── State (first-class) ─────────────────────────────────── */}
      <div>
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">State</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map(({ value, label, color }) => {
            const active = filters.statuses.has(value);
            return (
              <button
                key={value}
                onClick={() => toggleStatus(value)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  active ? `${color}` : 'bg-[#171511] border-[#2B2821] text-[#B4AA99] hover:text-[#D0C3AF] hover:border-[#3B372F]'
                }`}
              >{label}</button>
            );
          })}
        </div>
      </div>

      {/* ── Advanced section (BPM, key, scale, rating) ──────────── */}
      <div>
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] hover:text-[#D0C3AF] transition-colors"
        >
          {advancedOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          Advanced filters
          {(filters.bpmMin != null || filters.bpmMax != null || filters.keys.size > 0 || filters.scale !== 'all' || filters.rating != null) && (
            <span className="w-4 h-4 rounded-full bg-[#3a3020] text-[#D0C3AF] text-[8px] font-bold flex items-center justify-center ml-1">
              {[filters.bpmMin != null || filters.bpmMax != null, filters.keys.size > 0, filters.scale !== 'all', filters.rating != null].filter(Boolean).length}
            </span>
          )}
        </button>

        {advancedOpen && (
          <div className="mt-3 space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* BPM range */}
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">BPM range</p>
                <div className="flex items-center gap-2">
                  <input type="number" placeholder="Min" min={0} max={999} value={filters.bpmMin ?? ''}
                    onChange={(e) => set({ bpmMin: e.target.value ? Number(e.target.value) : null })}
                    className="w-full bg-[#171511] border border-[#2B2821] rounded-lg px-2.5 py-1.5 text-[12px] text-[#F7EBDD] placeholder-[#6E685B] focus:outline-none focus:border-[#6E685B] tabular-nums" />
                  <span className="text-[#6E685B] text-[10px] shrink-0">–</span>
                  <input type="number" placeholder="Max" min={0} max={999} value={filters.bpmMax ?? ''}
                    onChange={(e) => set({ bpmMax: e.target.value ? Number(e.target.value) : null })}
                    className="w-full bg-[#171511] border border-[#2B2821] rounded-lg px-2.5 py-1.5 text-[12px] text-[#F7EBDD] placeholder-[#6E685B] focus:outline-none focus:border-[#6E685B] tabular-nums" />
                </div>
              </div>

              {/* Scale */}
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">Scale</p>
                <div className="flex gap-1.5">
                  {(['all', 'major', 'minor'] as const).map((s) => (
                    <button key={s} onClick={() => set({ scale: s })}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors capitalize ${
                        filters.scale === s
                          ? s === 'minor' ? 'bg-[#1a1833] border border-[#534AB7]/40 text-[#9d95e8]'
                            : s === 'major' ? 'bg-[#1f1a10] border border-[#3d3020]/60 text-[#c8a47a]'
                            : 'bg-white text-black'
                          : 'bg-[#171511] border border-[#2B2821] text-[#B4AA99] hover:text-[#D0C3AF]'
                      }`}
                    >{s === 'all' ? 'Any' : s}</button>
                  ))}
                </div>
              </div>

              {/* Min rating */}
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">Min rating</p>
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map((star) => (
                    <button key={star} onClick={() => set({ rating: filters.rating === star ? null : star })}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-[14px] transition-colors ${
                        filters.rating != null && star <= filters.rating ? 'text-[#D6BE7A]' : 'text-[#3B372F] hover:text-[#D6BE7A]/60'
                      }`}>★</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Key picker */}
            <div>
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">Key</p>
              <div className="flex gap-1.5 flex-wrap">
                {CHROMATIC_KEYS.map((k) => (
                  <button key={k} onClick={() => toggleKey(k)}
                    className={`w-9 h-9 rounded-lg text-[11px] font-mono font-bold transition-all ${
                      filters.keys.has(k)
                        ? 'bg-[#342F27] border border-[#E7D7BE]/40 text-[#F3E6D1] shadow-[0_0_6px_rgba(231,215,190,0.12)]'
                        : 'bg-[#171511] border border-[#2B2821] text-[#9B9282] hover:text-[#D0C3AF] hover:border-[#3B372F]'
                    }`}>{k}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {hasActiveFilters(filters) && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[#211F1A]">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[#837B6D]">Active:</span>
          {Array.from(filters.genres).map((g) => <Chip key={g} label={g} onRemove={() => toggleGenre(g)} />)}
          {Array.from(filters.statuses).map((s) => {
            const opt = STATUS_OPTIONS.find((o) => o.value === s);
            return <Chip key={s} label={opt?.label ?? s} onRemove={() => toggleStatus(s)} />;
          })}
          {(filters.bpmMin != null || filters.bpmMax != null) && (
            <Chip label={`BPM ${filters.bpmMin ?? '?'}–${filters.bpmMax ?? '?'}`} onRemove={() => set({ bpmMin: null, bpmMax: null })} />
          )}
          {filters.scale !== 'all' && <Chip label={filters.scale} onRemove={() => set({ scale: 'all' })} />}
          {Array.from(filters.keys).map((k) => <Chip key={k} label={k} onRemove={() => toggleKey(k)} />)}
          {filters.rating != null && <Chip label={`★ ≥ ${filters.rating}`} onRemove={() => set({ rating: null })} />}
          <button
            onClick={() => onChange({ ...DEFAULT_FILTERS, genres: new Set(), statuses: new Set(), keys: new Set() })}
            className="text-[9px] font-mono text-[#B4AA99] hover:text-[#F7EBDD] ml-1 transition-colors"
          >Clear all</button>
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-[#211F1A] border border-[#3B372F] rounded-full pl-2.5 pr-1.5 py-1 text-[10px] text-[#F7EBDD] font-mono">
      {label}
      <button onClick={onRemove} className="text-[#B4AA99] hover:text-white transition-colors leading-none">
        <X size={9} />
      </button>
    </span>
  );
}
