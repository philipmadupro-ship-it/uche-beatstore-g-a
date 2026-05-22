'use client';

/**
 * AddFromLibraryModal — pick existing library tracks and attach them to a
 * project (or playlist). Multi-select, search, type filter.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Music, Loader2, Plus, Check } from 'lucide-react';
import { fmtBpm, fmtKey, fmtDuration } from '@/lib/audio/format';

interface Props {
  /** Endpoint to POST { track_ids } to. Defaults to project tracks. */
  endpoint: string;
  /** Track IDs already attached — they'll be disabled in the picker. */
  excludeIds?: string[];
  onClose: () => void;
  onAdded?: (count: number) => void;
  title?: string;
}

export function AddFromLibraryModal({
  endpoint,
  excludeIds = [],
  onClose,
  onAdded,
  title = 'Add from library',
}: Props) {
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'instrumental' | 'song' | 'remix'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tracks');
        const data = await res.json();
        setTracks(Array.isArray(data) ? data : data.tracks || []);
      } catch (err: any) {
        setError(err?.message || 'Failed to load library');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (!q) return true;
      return (t.title || '').toLowerCase().includes(q);
    });
  }, [tracks, search, typeFilter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      onAdded?.(data.added ?? selected.size);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to add');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0a0907] border border-[#1a160f] rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 h-14 border-b border-[#16130e]">
          <div>
            <h2 className="text-[14px] font-medium text-white">{title}</h2>
            <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-widest mt-0.5">
              {selected.size} selected · {filtered.length} available
            </p>
          </div>
          <button onClick={onClose} className="text-[#5a5142] hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-[#16130e] flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your library"
              className="w-full bg-[#0e0c08] border border-[#1a160f] rounded-md pl-8 pr-3 py-2 text-[12px] text-[#E8DCC8] placeholder-[#4a4338] focus:outline-none focus:border-[#D4BFA0]"
            />
          </div>
          <div className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider">
            {(['all', 'instrumental', 'song', 'remix'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  typeFilter === t
                    ? 'bg-[#2A2418] text-[#E8D8B8] border border-[#8A7A5C]'
                    : 'text-[#5a5142] hover:text-[#a08a6a] border border-transparent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={18} className="animate-spin text-[#4a4338]" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-[12px] text-red-400">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Music size={20} className="mx-auto text-[#2d2620] mb-3" />
              <p className="text-[11px] text-[#5a5142]">No tracks match your search</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((t) => {
                const isExcluded = excluded.has(t.id);
                const isSelected = selected.has(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={isExcluded}
                      onClick={() => toggle(t.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                        isExcluded
                          ? 'opacity-40 cursor-not-allowed'
                          : isSelected
                            ? 'bg-[#2A2418] border border-[#8A7A5C]/60'
                            : 'border border-transparent hover:bg-[#16130e]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-[#D4BFA0] border-[#D4BFA0]' : 'border-[#2d2620] bg-[#0a0907]'
                      }`}>
                        {isSelected && <Check size={12} className="text-white" />}
                      </div>
                      <div className="w-9 h-9 rounded bg-[#14110d] border border-[#1a160f] flex items-center justify-center shrink-0 overflow-hidden">
                        {t.cover_url ? (
                          <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Music size={14} className="text-[#3a3328]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-[#E8DCC8] truncate">{t.title}</p>
                        <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mt-0.5">
                          {t.type}{isExcluded ? ' · already in project' : ''}
                        </p>
                      </div>
                      <span className="text-[10px] font-mono text-[#5a5142] w-14 text-right">{fmtBpm(t.bpm)}</span>
                      <span className="text-[10px] font-mono text-[#5a5142] w-16 text-right">{fmtKey(t.key, t.scale)}</span>
                      <span className="text-[10px] font-mono text-[#5a5142] w-12 text-right">{fmtDuration(t.duration_seconds)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-6 h-14 border-t border-[#16130e] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-[10px] text-[#5a5142] font-mono uppercase tracking-widest">
              {selected.size > 0 ? `${selected.size} ready to attach` : 'Select tracks to attach'}
            </p>
            {filtered.length > 0 && (
              <>
                <span className="text-[#16130e] font-mono">·</span>
                <button
                  type="button"
                  onClick={() => {
                    const nonExcludedFiltered = filtered.filter((t) => !excluded.has(t.id));
                    const allSelected = nonExcludedFiltered.every((t) => selected.has(t.id));
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (allSelected) {
                        nonExcludedFiltered.forEach((t) => next.delete(t.id));
                      } else {
                        nonExcludedFiltered.forEach((t) => next.add(t.id));
                      }
                      return next;
                    });
                  }}
                  className="text-[10px] font-mono uppercase tracking-wider text-[#D4BFA0] hover:text-[#E8D8B8] cursor-pointer transition-colors"
                >
                  {filtered.filter((t) => !excluded.has(t.id)).every((t) => selected.has(t.id)) ? 'Deselect All' : 'Select All'}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-[12px] text-[#a08a6a] hover:text-white px-3 py-1.5 rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={selected.size === 0 || submitting}
              className="flex items-center gap-2 bg-[#D4BFA0] disabled:bg-[#1a160f] disabled:text-[#5a5142] text-white px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
