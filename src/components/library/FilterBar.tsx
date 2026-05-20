'use client';

import { X } from 'lucide-react';

const CHROMATIC_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];

const STATUS_LABELS: Record<string, string> = {
  finished: 'Finished',
  needs_work: 'Needs work',
  archived: 'Archived',
};

export interface LibraryFilters {
  bpmMin: number | null;
  bpmMax: number | null;
  keys: Set<string>;
  scale: 'all' | 'major' | 'minor';
  statuses: Set<string>;
  rating: number | null;
}

export const DEFAULT_FILTERS: LibraryFilters = {
  bpmMin: null,
  bpmMax: null,
  keys: new Set(),
  scale: 'all',
  statuses: new Set(),
  rating: null,
};

export function hasActiveFilters(f: LibraryFilters): boolean {
  return (
    f.bpmMin != null ||
    f.bpmMax != null ||
    f.keys.size > 0 ||
    f.scale !== 'all' ||
    f.statuses.size > 0 ||
    f.rating != null
  );
}

function activeFilterCount(f: LibraryFilters): number {
  return [
    f.bpmMin != null || f.bpmMax != null,
    f.keys.size > 0,
    f.scale !== 'all',
    f.statuses.size > 0,
    f.rating != null,
  ].filter(Boolean).length;
}

interface FilterBarProps {
  filters: LibraryFilters;
  onChange: (f: LibraryFilters) => void;
}

export { activeFilterCount };

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const set = (partial: Partial<LibraryFilters>) => onChange({ ...filters, ...partial });

  const toggleKey = (k: string) => {
    const next = new Set(filters.keys);
    if (next.has(k)) next.delete(k); else next.add(k);
    set({ keys: next });
  };

  const toggleStatus = (s: string) => {
    const next = new Set(filters.statuses);
    if (next.has(s)) next.delete(s); else next.add(s);
    set({ statuses: next });
  };

  return (
    <div className="bg-[#0e0c08] border border-[#1a160f] rounded-xl p-4 mb-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* BPM range */}
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">BPM range</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Min"
              min={0}
              max={999}
              value={filters.bpmMin ?? ''}
              onChange={(e) => set({ bpmMin: e.target.value ? Number(e.target.value) : null })}
              className="w-full bg-[#14110d] border border-[#1f1a13] rounded-lg px-2.5 py-1.5 text-[12px] text-[#E8DCC8] placeholder-[#3a3328] focus:outline-none focus:border-[#3a3328] tabular-nums"
            />
            <span className="text-[#3a3328] text-[10px] shrink-0">–</span>
            <input
              type="number"
              placeholder="Max"
              min={0}
              max={999}
              value={filters.bpmMax ?? ''}
              onChange={(e) => set({ bpmMax: e.target.value ? Number(e.target.value) : null })}
              className="w-full bg-[#14110d] border border-[#1f1a13] rounded-lg px-2.5 py-1.5 text-[12px] text-[#E8DCC8] placeholder-[#3a3328] focus:outline-none focus:border-[#3a3328] tabular-nums"
            />
          </div>
        </div>

        {/* Scale */}
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Scale</p>
          <div className="flex gap-1.5">
            {(['all', 'major', 'minor'] as const).map((s) => (
              <button
                key={s}
                onClick={() => set({ scale: s })}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors capitalize ${
                  filters.scale === s
                    ? s === 'minor'
                      ? 'bg-[#1a1833] border border-[#534AB7]/40 text-[#9d95e8]'
                      : s === 'major'
                        ? 'bg-[#1f1a10] border border-[#3d3020]/60 text-[#c8a47a]'
                        : 'bg-white text-black'
                    : 'bg-[#14110d] border border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a]'
                }`}
              >
                {s === 'all' ? 'Any' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Status</p>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(STATUS_LABELS).map(([val, label]) => (
              <button
                key={val}
                onClick={() => toggleStatus(val)}
                className={`px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                  filters.statuses.has(val)
                    ? 'bg-[#2A2418] border border-[#8A7A5C]/40 text-[#E8D8B8]'
                    : 'bg-[#14110d] border border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Min rating */}
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Min rating</p>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => set({ rating: filters.rating === star ? null : star })}
                className={`w-7 h-7 rounded-lg flex items-center justify-center text-[14px] transition-colors ${
                  filters.rating != null && star <= filters.rating
                    ? 'text-[#c8a84b]'
                    : 'text-[#2d2620] hover:text-[#c8a84b]/60'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Key picker — chromatic in circle-of-fifths order */}
      <div>
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Key</p>
        <div className="flex gap-1.5 flex-wrap">
          {CHROMATIC_KEYS.map((k) => {
            const active = filters.keys.has(k);
            return (
              <button
                key={k}
                onClick={() => toggleKey(k)}
                className={`w-9 h-9 rounded-lg text-[11px] font-mono font-bold transition-all ${
                  active
                    ? 'bg-[#2A2418] border border-[#D4BFA0]/40 text-[#E8D8B8] shadow-[0_0_6px_rgba(212,191,160,0.12)]'
                    : 'bg-[#14110d] border border-[#1f1a13] text-[#5a5142] hover:text-[#a08a6a] hover:border-[#2d2620]'
                }`}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters(filters) && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[#1a160f]">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[#4a4338]">Active:</span>
          {(filters.bpmMin != null || filters.bpmMax != null) && (
            <Chip
              label={`BPM ${filters.bpmMin ?? '?'} – ${filters.bpmMax ?? '?'}`}
              onRemove={() => set({ bpmMin: null, bpmMax: null })}
            />
          )}
          {filters.scale !== 'all' && (
            <Chip label={filters.scale} onRemove={() => set({ scale: 'all' })} />
          )}
          {Array.from(filters.keys).map((k) => (
            <Chip key={k} label={k} onRemove={() => toggleKey(k)} />
          ))}
          {Array.from(filters.statuses).map((s) => (
            <Chip key={s} label={STATUS_LABELS[s] ?? s} onRemove={() => toggleStatus(s)} />
          ))}
          {filters.rating != null && (
            <Chip label={`★ ≥ ${filters.rating}`} onRemove={() => set({ rating: null })} />
          )}
          <button
            onClick={() => onChange({ ...DEFAULT_FILTERS, keys: new Set(), statuses: new Set() })}
            className="text-[9px] font-mono text-[#6a5d4a] hover:text-[#E8DCC8] ml-1 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-[#1a160f] border border-[#2d2620] rounded-full pl-2.5 pr-1.5 py-1 text-[10px] text-[#E8DCC8] font-mono">
      {label}
      <button onClick={onRemove} className="text-[#6a5d4a] hover:text-white transition-colors leading-none">
        <X size={9} />
      </button>
    </span>
  );
}
