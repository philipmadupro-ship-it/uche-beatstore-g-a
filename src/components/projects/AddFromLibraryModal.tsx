'use client';

/**
 * AddFromLibraryModal — pick existing library tracks and attach them to a
 * project or playlist. Multi-select with search, type, BPM range, key, and
 * tag filters. Used by both project and playlist detail pages.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Music, Loader2, Check, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { fmtBpm, fmtKey, fmtDuration } from '@/lib/audio/format';
import { TAG_TAXONOMY } from '@/lib/types/tags';

interface Props {
  endpoint: string;
  excludeIds?: string[];
  onClose: () => void;
  onAdded?: (count: number) => void;
  title?: string;
}

const TYPE_OPTIONS = ['all', 'beat', 'instrumental', 'song', 'remix'] as const;
const KEY_OPTIONS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function AddFromLibraryModal({ endpoint, excludeIds = [], onClose, onAdded, title = 'Add from library' }: Props) {
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [bpmMin, setBpmMin] = useState('');
  const [bpmMax, setBpmMax] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tracks');
        const data = await res.json();
        setTracks(Array.isArray(data) ? data : data.tracks || []);
      } catch (err: any) { setError(err?.message || 'Failed to load library'); }
      finally { setLoading(false); }
    })();
  }, []);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bMin = bpmMin !== '' ? Number(bpmMin) : null;
    const bMax = bpmMax !== '' ? Number(bpmMax) : null;
    return tracks.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (bMin !== null && (t.bpm == null || t.bpm < bMin)) return false;
      if (bMax !== null && (t.bpm == null || t.bpm > bMax)) return false;
      if (keyFilter && (t.key ?? '').toLowerCase() !== keyFilter.toLowerCase()) return false;
      if (selectedTags.size > 0) {
        const owned = (t.track_tags ?? []).map((tt: any) => tt.tag);
        if (![...selectedTags].every((sel) => owned.includes(sel))) return false;
      }
      if (q) return (t.title || '').toLowerCase().includes(q);
      return true;
    });
  }, [tracks, search, typeFilter, bpmMin, bpmMax, keyFilter, selectedTags]);

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTag = (tag: string) => setSelectedTags((prev) => { const n = new Set(prev); n.has(tag) ? n.delete(tag) : n.add(tag); return n; });
  const nonExcluded = filtered.filter((t) => !excluded.has(t.id));
  const allSel = nonExcluded.length > 0 && nonExcluded.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected((prev) => { const n = new Set(prev); allSel ? nonExcluded.forEach((t) => n.delete(t.id)) : nonExcluded.forEach((t) => n.add(t.id)); return n; });
  const clearFilters = () => { setSearch(''); setTypeFilter('all'); setBpmMin(''); setBpmMax(''); setKeyFilter(''); setSelectedTags(new Set()); };
  const activeCount = [typeFilter !== 'all', bpmMin !== '', bpmMax !== '', keyFilter !== '', selectedTags.size > 0].filter(Boolean).length;

  const submit = async () => {
    if (!selected.size) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track_ids: [...selected] }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      onAdded?.(data.added ?? selected.size); onClose();
    } catch (err: any) { setError(err?.message || 'Failed to add'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="bg-[#0c0a08] border border-[#1a160f] rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-[#16130e] shrink-0">
          <div>
            <h2 className="text-[14px] font-semibold text-white">{title}</h2>
            <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-widest mt-0.5">
              {selected.size > 0 ? `${selected.size} selected · ` : ''}{filtered.length} track{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-[#5a5142] hover:text-white p-1 transition-colors"><X size={16} /></button>
        </div>

        {/* Search + filter toggle */}
        <div className="px-5 py-3 border-b border-[#16130e] space-y-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338] pointer-events-none" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tracks…"
                className="w-full bg-[#0e0c08] border border-[#1a160f] rounded-lg pl-8 pr-3 py-2 text-[13px] text-[#E8DCC8] placeholder:text-[#4a4338] focus:outline-none focus:border-[#2d2620]" />
            </div>
            <button onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium border transition-colors shrink-0 ${showFilters || activeCount > 0 ? 'bg-[#2A2418] text-[#E8D8B8] border-[#8A7A5C]/40' : 'bg-[#14110d] border-[#1f1a13] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620]'}`}>
              <SlidersHorizontal size={12} />
              Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
              <ChevronDown size={11} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            {activeCount > 0 && <button onClick={clearFilters} className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors px-1 shrink-0">Clear</button>}
          </div>

          {showFilters && (
            <div className="space-y-3 pt-1">
              {/* Type */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] w-10 shrink-0">Type</span>
                {TYPE_OPTIONS.map((t) => (
                  <button key={t} onClick={() => setTypeFilter(t)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border capitalize transition-all ${typeFilter === t ? 'bg-[#D4BFA0] text-black border-[#D4BFA0]' : 'bg-transparent border-[#1f1a13] text-[#6a5d4a] hover:border-[#2d2620] hover:text-[#a08a6a]'}`}>
                    {t}
                  </button>
                ))}
              </div>
              {/* BPM + Key */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] w-10 shrink-0">BPM</span>
                <input type="number" value={bpmMin} onChange={(e) => setBpmMin(e.target.value)} placeholder="Min"
                  className="w-20 bg-[#0e0c08] border border-[#1f1a13] rounded-md px-2.5 py-1 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] font-mono" />
                <span className="text-[#3a3328]">—</span>
                <input type="number" value={bpmMax} onChange={(e) => setBpmMax(e.target.value)} placeholder="Max"
                  className="w-20 bg-[#0e0c08] border border-[#1f1a13] rounded-md px-2.5 py-1 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] font-mono" />
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] ml-2">Key</span>
                <select value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)}
                  className="bg-[#0e0c08] border border-[#1f1a13] rounded-md px-2 py-1 text-[11px] text-[#E8DCC8] focus:outline-none focus:border-[#2d2620] font-mono cursor-pointer">
                  <option value="">Any key</option>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k} className="bg-[#0a0907]">{k}</option>)}
                </select>
              </div>
              {/* Tags */}
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] w-10 shrink-0 mt-1">Tags</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {[...TAG_TAXONOMY.genre.slice(0, 8), ...TAG_TAXONOMY.mood.slice(0, 5)].map((tag) => {
                    const on = selectedTags.has(tag);
                    return (
                      <button key={tag} onClick={() => toggleTag(tag)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${on ? 'bg-[#D4BFA0] text-black border-[#D4BFA0]' : 'bg-transparent border-[#1f1a13] text-[#6a5d4a] hover:border-[#2d2620] hover:text-[#a08a6a]'}`}>
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Track list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={18} className="animate-spin text-[#4a4338]" /></div>
          ) : error ? (
            <div className="text-center py-12 text-[12px] text-red-400">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Music size={20} className="mx-auto text-[#2d2620] mb-3" />
              <p className="text-[11px] text-[#5a5142]">No tracks match</p>
              {activeCount > 0 && <button onClick={clearFilters} className="mt-2 text-[10px] text-[#a08a6a] hover:text-[#E8DCC8] underline underline-offset-2">Clear filters</button>}
            </div>
          ) : (
            <ul>
              {filtered.map((t) => {
                const isExcluded = excluded.has(t.id);
                const isSel = selected.has(t.id);
                return (
                  <li key={t.id}>
                    <button type="button" disabled={isExcluded} onClick={() => toggle(t.id)}
                      className={`w-full flex items-center gap-3 px-5 py-3 border-b border-[#0e0c08]/60 text-left transition-colors ${isExcluded ? 'opacity-35 cursor-not-allowed' : isSel ? 'bg-[#1a160f]' : 'hover:bg-[#14110d]'}`}>
                      <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${isSel ? 'bg-[#D4BFA0] border-[#D4BFA0]' : 'border-[#2d2620]'}`}>
                        {isSel && <Check size={11} className="text-black" />}
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-[#14110d] border border-[#1a160f] flex items-center justify-center shrink-0 overflow-hidden">
                        {t.cover_url ? <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" /> : <Music size={14} className="text-[#3a3328]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#E8DCC8] truncate">{t.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">{t.type}</span>
                          {(t.track_tags ?? []).slice(0, 2).map((tt: any) => (
                            <span key={tt.tag} className="text-[8px] font-mono uppercase tracking-wider text-[#a08a6a] bg-[#1a160f] border border-[#2d2620] px-1 py-0.5 rounded">{tt.tag}</span>
                          ))}
                          {isExcluded && <span className="text-[8px] font-mono text-[#4a4338]">already added</span>}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-[#5a5142] tabular-nums shrink-0 w-16 text-right">{fmtBpm(t.bpm)}</span>
                      <span className="text-[10px] font-mono text-[#5a5142] w-14 text-right shrink-0">{fmtKey(t.key, t.scale)}</span>
                      <span className="text-[10px] font-mono text-[#3a3328] w-12 text-right shrink-0">{fmtDuration(t.duration_seconds)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 h-14 border-t border-[#16130e] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-[10px] text-[#5a5142] font-mono uppercase tracking-widest">
              {selected.size > 0 ? `${selected.size} selected` : 'Select tracks'}
            </p>
            {nonExcluded.length > 0 && (
              <>
                <span className="text-[#1a160f]">·</span>
                <button onClick={toggleAll} className="text-[10px] font-mono uppercase tracking-wider text-[#D4BFA0] hover:text-[#E8D8B8] transition-colors">
                  {allSel ? 'Deselect all' : `Select all (${nonExcluded.length})`}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {error && <p className="text-[10px] text-red-400 mr-2 max-w-[200px] truncate">{error}</p>}
            <button onClick={onClose} className="text-[12px] text-[#a08a6a] hover:text-white px-3 py-1.5 rounded-lg transition-colors">Cancel</button>
            <button onClick={submit} disabled={selected.size === 0 || submitting}
              className="flex items-center gap-2 bg-[#D4BFA0] hover:bg-[#E8D8B8] disabled:opacity-40 text-black px-5 py-2 rounded-lg text-[12px] font-semibold transition-colors">
              {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
              Add {selected.size > 0 ? `${selected.size} track${selected.size !== 1 ? 's' : ''}` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
