'use client';

/**
 * AddFromLibraryModal — pick existing library tracks and attach them to a
 * project or playlist. Multi-select with search, type, BPM range, key, and
 * tag filters. Used by both project and playlist detail pages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { X, Search, Music, Loader2, Check, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { fmtBpm, fmtKey, fmtDuration } from '@/lib/audio/format';
import { errorMessage } from '@/lib/errors';
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
const TRACK_PAGE_SIZE = 80;

interface LibraryTrackTag {
  tag: string;
  category?: string | null;
}

interface LibraryTrack {
  id: string;
  title: string;
  type: string;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  track_tags?: LibraryTrackTag[] | null;
}

interface TracksResponse {
  tracks?: LibraryTrack[];
  pageInfo?: {
    hasMore?: boolean;
    nextCursor?: string | null;
  };
  error?: string;
}

interface AddTracksResponse {
  added?: number;
  error?: string;
}

export function AddFromLibraryModal({ endpoint, excludeIds = [], onClose, onAdded, title = 'Add from library' }: Props) {
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const buildTrackQuery = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams({
      paged: '1',
      lean: '1',
      limit: String(TRACK_PAGE_SIZE),
    });
    if (cursor) params.set('cursor', cursor);
    if (search.trim()) params.set('q', search.trim());
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (bpmMin.trim()) params.set('min_bpm', bpmMin.trim());
    if (bpmMax.trim()) params.set('max_bpm', bpmMax.trim());
    if (keyFilter) params.set('key', keyFilter);
    if (selectedTags.size === 1) params.set('tag', [...selectedTags][0]);
    return params;
  }, [bpmMax, bpmMin, keyFilter, search, selectedTags, typeFilter]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = buildTrackQuery();
        const res = await fetch(`/api/tracks?${params.toString()}`);
        const data = await res.json() as TracksResponse;
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
        setTracks(data.tracks || []);
        setHasMore(Boolean(data.pageInfo?.hasMore));
        setNextCursor(data.pageInfo?.nextCursor ?? null);
      } catch (err: unknown) { setError(errorMessage(err) || 'Failed to load library'); }
      finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(timer);
  }, [buildTrackQuery]);

  const loadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const params = buildTrackQuery(nextCursor);
      const res = await fetch(`/api/tracks?${params.toString()}`);
      const data = await res.json() as TracksResponse;
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setTracks((current) => {
        const seen = new Set(current.map((track) => track.id));
        const incoming = (data.tracks || []).filter((track) => !seen.has(track.id));
        return [...current, ...incoming];
      });
      setHasMore(Boolean(data.pageInfo?.hasMore));
      setNextCursor(data.pageInfo?.nextCursor ?? null);
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Failed to load more tracks');
    } finally {
      setLoadingMore(false);
    }
  };

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks.filter((t) => {
      if (selectedTags.size > 0) {
        const owned = (t.track_tags ?? []).map((tt) => tt.tag);
        if (![...selectedTags].every((sel) => owned.includes(sel))) return false;
      }
      if (q) return (t.title || '').toLowerCase().includes(q);
      return true;
    });
  }, [tracks, search, selectedTags]);

  const toggle = (id: string) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleTag = (tag: string) => setSelectedTags((prev) => {
    const n = new Set(prev);
    if (n.has(tag)) n.delete(tag);
    else n.add(tag);
    return n;
  });
  const nonExcluded = filtered.filter((t) => !excluded.has(t.id));
  const allSel = nonExcluded.length > 0 && nonExcluded.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected((prev) => {
    const n = new Set(prev);
    if (allSel) nonExcluded.forEach((t) => n.delete(t.id));
    else nonExcluded.forEach((t) => n.add(t.id));
    return n;
  });
  const clearFilters = () => { setSearch(''); setTypeFilter('all'); setBpmMin(''); setBpmMax(''); setKeyFilter(''); setSelectedTags(new Set()); };
  const activeCount = [typeFilter !== 'all', bpmMin !== '', bpmMax !== '', keyFilter !== '', selectedTags.size > 0].filter(Boolean).length;

  const submit = async () => {
    if (!selected.size) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track_ids: [...selected] }) });
      const data = await res.json().catch(() => ({})) as AddTracksResponse;
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      onAdded?.(data.added ?? selected.size); onClose();
    } catch (err: unknown) { setError(errorMessage(err) || 'Failed to add'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-[#0D0D0A] shrink-0">
          <div>
            <h2 className="text-[14px] font-semibold text-white">{title}</h2>
            <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-0.5">
              {selected.size > 0 ? `${selected.size} selected · ` : ''}{filtered.length} track{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1 transition-colors"><X size={16} /></button>
        </div>

        {/* Search + filter toggle */}
        <div className="px-5 py-3 border-b border-[#0D0D0A] space-y-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tracks…"
                className="w-full bg-white/[0.02] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-[13px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20" />
            </div>
            <button onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium border transition-colors shrink-0 ${showFilters || activeCount > 0 ? 'bg-white/10 text-white border-white/' : 'bg-white/[0.04] border-white/10 text-white/80 hover:text-white hover:border-white/20'}`}>
              <SlidersHorizontal size={12} />
              Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
              <ChevronDown size={11} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            {activeCount > 0 && <button onClick={clearFilters} className="text-[10px] font-mono uppercase tracking-wider text-white/60 hover:text-white transition-colors px-1 shrink-0">Clear</button>}
          </div>

          {showFilters && (
            <div className="space-y-3 pt-1">
              {/* Type */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 w-10 shrink-0">Type</span>
                {TYPE_OPTIONS.map((t) => (
                  <button key={t} onClick={() => setTypeFilter(t)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border capitalize transition-all ${typeFilter === t ? 'bg-white text-black border-white/30' : 'bg-transparent border-white/10 text-white/60 hover:border-white/20 hover:text-white/80'}`}>
                    {t}
                  </button>
                ))}
              </div>
              {/* BPM + Key */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 w-10 shrink-0">BPM</span>
                <input type="number" value={bpmMin} onChange={(e) => setBpmMin(e.target.value)} placeholder="Min"
                  className="w-20 bg-white/[0.02] border border-white/10 rounded-md px-2.5 py-1 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 font-mono" />
                <span className="text-white/30">—</span>
                <input type="number" value={bpmMax} onChange={(e) => setBpmMax(e.target.value)} placeholder="Max"
                  className="w-20 bg-white/[0.02] border border-white/10 rounded-md px-2.5 py-1 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 font-mono" />
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 ml-2">Key</span>
                <select value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)}
                  className="bg-white/[0.02] border border-white/10 rounded-md px-2 py-1 text-[11px] text-white focus:outline-none focus:border-white/20 font-mono cursor-pointer">
                  <option value="">Any key</option>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k} className="bg-[#090907]">{k}</option>)}
                </select>
              </div>
              {/* Tags */}
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 w-10 shrink-0 mt-1">Tags</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {[...TAG_TAXONOMY.genre.slice(0, 8), ...TAG_TAXONOMY.mood.slice(0, 5)].map((tag) => {
                    const on = selectedTags.has(tag);
                    return (
                      <button key={tag} onClick={() => toggleTag(tag)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${on ? 'bg-white text-black border-white/30' : 'bg-transparent border-white/10 text-white/60 hover:border-white/20 hover:text-white/80'}`}>
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
            <div className="flex items-center justify-center py-20"><Loader2 size={18} className="animate-spin text-white/40" /></div>
          ) : error ? (
            <div className="text-center py-12 text-[12px] text-red-400">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Music size={20} className="mx-auto text-white/30 mb-3" />
              <p className="text-[11px] text-white/40">No tracks match</p>
              {activeCount > 0 && <button onClick={clearFilters} className="mt-2 text-[10px] text-white/80 hover:text-white underline underline-offset-2">Clear filters</button>}
            </div>
          ) : (
            <ul>
              {filtered.map((t) => {
                const isExcluded = excluded.has(t.id);
                const isSel = selected.has(t.id);
                return (
                  <li key={t.id}>
                    <button type="button" disabled={isExcluded} onClick={() => toggle(t.id)}
                      className={`w-full flex items-center gap-3 px-5 py-3 border-b border-white/ text-left transition-colors ${isExcluded ? 'opacity-35 cursor-not-allowed' : isSel ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}>
                      <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${isSel ? 'bg-white border-white/30' : 'border-white/20'}`}>
                        {isSel && <Check size={11} className="text-black" />}
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {t.cover_url ? <Image src={t.cover_url} alt="" width={40} height={40} className="w-full h-full object-cover" unoptimized /> : <Music size={14} className="text-white/30" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white truncate">{t.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">{t.type}</span>
                          {(t.track_tags ?? []).slice(0, 2).map((tt) => (
                            <span key={tt.tag} className="text-[8px] font-mono uppercase tracking-wider text-white/80 bg-white/[0.05] border border-white/20 px-1 py-0.5 rounded">{tt.tag}</span>
                          ))}
                          {isExcluded && <span className="text-[8px] font-mono text-white/40">already added</span>}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-white/40 tabular-nums shrink-0 w-16 text-right">{fmtBpm(t.bpm)}</span>
                      <span className="text-[10px] font-mono text-white/40 w-14 text-right shrink-0">{fmtKey(t.key, t.scale)}</span>
                      <span className="text-[10px] font-mono text-white/30 w-12 text-right shrink-0">{fmtDuration(t.duration_seconds)}</span>
                    </button>
                  </li>
                );
              })}
              {hasMore && (
                <li className="px-5 py-4">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-white/80 transition-colors hover:border-white/20 hover:text-white disabled:cursor-wait disabled:opacity-60"
                  >
                    {loadingMore ? 'Loading tracks...' : 'Load more tracks'}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 h-14 border-t border-[#0D0D0A] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">
              {selected.size > 0 ? `${selected.size} selected` : 'Select tracks'}
            </p>
            {nonExcluded.length > 0 && (
              <>
                <span className="text-black">·</span>
                <button onClick={toggleAll} className="text-[10px] font-mono uppercase tracking-wider text-white hover:text-white transition-colors">
                  {allSel ? 'Deselect all' : `Select all (${nonExcluded.length})`}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {error && <p className="text-[10px] text-red-400 mr-2 max-w-[200px] truncate">{error}</p>}
            <button onClick={onClose} className="text-[12px] text-white/80 hover:text-white px-3 py-1.5 rounded-lg transition-colors">Cancel</button>
            <button onClick={submit} disabled={selected.size === 0 || submitting}
              className="flex items-center gap-2 bg-white hover:bg-white disabled:opacity-40 text-black px-5 py-2 rounded-lg text-[12px] font-semibold transition-colors">
              {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
              Add {selected.size > 0 ? `${selected.size} track${selected.size !== 1 ? 's' : ''}` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
