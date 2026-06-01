'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Music, ChevronRight, ChevronDown, Plus, Search, Layers, X } from 'lucide-react';
import Link from 'next/link';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/**
 * Discovery surface — the matching tool that seeds from the current track
 * (the beat behind the lyric/project) and surfaces compatible beats and
 * instrumentals from the producer's library. Replaces the old single-button
 * "find matches" with a browsable, filterable panel: search by title, narrow
 * by type / state / tag, and tighten to harmonic-key + tempo-compatible only.
 *
 * Scoring (BPM half/double-time aware + Camelot key + vibe + type) lives in
 * /api/tracks/[id]/similar; this is the UI that lets the producer slice it.
 */

interface SimilarTrack {
  track: {
    id: string;
    title: string;
    type: string;
    status?: string | null;
    cover_url?: string | null;
    bpm?: number | null;
    key?: string | null;
    scale?: string | null;
    tags?: string[];
  };
  distance: number;
  breakdown: { bpm: number; key: number; vibe: number; type: number };
}

interface Props {
  trackId: string;
  /** When set, clicking a result calls this instead of navigating — lets a
   *  playlist/project/send builder consume the picks. */
  onPick?: (trackId: string) => void;
}

const STATE_LABEL: Record<string, string> = {
  finished: 'Finished',
  needs_work: 'Needs work',
  archived: 'Archived',
  maq: 'MAQ',
};

// Harmonic = same slot or one step on the Camelot wheel (keyDistance ≲ 0.34).
const HARMONIC_MAX = 0.34;
// Tempo-compatible = within the close band of the BPM scorer.
const TEMPO_MAX = 0.3;

export function SimilarTracks({ trackId, onPick }: Props) {
  const [results, setResults] = useState<SimilarTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Collapsed by default — the matches stay tucked behind a toggle so they
  // don't eat the page. Opening it lazy-loads the first time.
  const [expanded, setExpanded] = useState(false);

  // Filters
  const [q, setQ] = useState('');
  const [type, setType] = useState<string>('all');
  const [state, setState] = useState<string>('all');
  const [tag, setTag] = useState<string>('all');
  const [harmonic, setHarmonic] = useState(false);
  const [tempoClose, setTempoClose] = useState(false);

  const fetchSimilar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracks/${trackId}/similar?limit=30`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (err) {
      console.error('Discovery failed:', err);
      toast.error('Couldn’t load matches', err instanceof Error ? err.message : 'Network error');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Reset + collapse when the track changes; no fetch until the user opens it.
  useEffect(() => {
    setResults(null);
    setExpanded(false);
    setQ(''); setType('all'); setState('all'); setTag('all');
    setHarmonic(false); setTempoClose(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  const toggleOpen = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && results === null && !loading) fetchSimilar();
      return next;
    });
  };

  const matchPct = (distance: number) => Math.max(0, Math.round((1 - distance / 2) * 100));

  // Facet values present in the result set (so we only show usable chips).
  const { types, states, tags } = useMemo(() => {
    const t = new Set<string>(); const s = new Set<string>(); const g = new Set<string>();
    for (const r of results ?? []) {
      if (r.track.type) t.add(r.track.type);
      if (r.track.status) s.add(r.track.status);
      for (const tg of r.track.tags ?? []) g.add(tg);
    }
    return { types: [...t], states: [...s], tags: [...g].sort() };
  }, [results]);

  const filtered = useMemo(() => {
    let list = results ?? [];
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((r) => r.track.title.toLowerCase().includes(needle));
    if (type !== 'all') list = list.filter((r) => r.track.type === type);
    if (state !== 'all') list = list.filter((r) => r.track.status === state);
    if (tag !== 'all') list = list.filter((r) => (r.track.tags ?? []).includes(tag));
    if (harmonic) list = list.filter((r) => r.breakdown.key <= HARMONIC_MAX);
    if (tempoClose) list = list.filter((r) => r.breakdown.bpm <= TEMPO_MAX);
    return list;
  }, [results, q, type, state, tag, harmonic, tempoClose]);

  const activeFilters = [type !== 'all', state !== 'all', tag !== 'all', harmonic, tempoClose, q.trim() !== ''].filter(Boolean).length;
  const clearAll = () => { setQ(''); setType('all'); setState('all'); setTag('all'); setHarmonic(false); setTempoClose(false); };

  return (
    <div className="mb-10">
      {/* Toggle header — collapsed by default so matches don't take up space.
          Click to unlock + lazy-load the discovery surface. */}
      <button
        onClick={toggleOpen}
        className={cn(
          'w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-colors text-left',
          expanded
            ? 'border-[#1f1a13] bg-[#0e0c08] rounded-b-none'
            : 'border-[#1f1a13] bg-[#14110d] hover:border-[#2d2620] hover:bg-[#1a160f]',
        )}
      >
        <Layers size={13} className="text-[#a08a6a] shrink-0" />
        <span className="text-[11px] font-medium text-[#E8DCC8]">Discover &amp; match</span>
        <span className="text-[10px] font-mono text-[#5a5142] hidden sm:inline">
          {results ? `${filtered.length} of ${results.length} matches` : 'compatible beats & instrumentals'}
        </span>
        <div className="flex-1" />
        {loading && <Loader2 size={12} className="animate-spin text-[#5a5142]" />}
        <span className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a]">
          {expanded ? 'Hide' : 'Show'}
        </span>
        <ChevronDown size={14} className={cn('text-[#5a5142] transition-transform', expanded && 'rotate-180')} />
      </button>

      {!expanded ? null : (
      <div className="border border-t-0 border-[#1f1a13] rounded-b-xl bg-[#0c0a08] p-3">
      <div className="flex items-center justify-end mb-2.5">
        <button
          onClick={fetchSimilar}
          disabled={loading}
          className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Filter bar */}
      {results && results.length > 0 && (
        <div className="rounded-xl border border-[#1f1a13] bg-[#0e0c08] p-3 mb-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Search size={12} className="text-[#4a4338] shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search matches by title…"
              className="flex-1 bg-transparent text-[12px] text-[#E8DCC8] placeholder:text-[#4a4338] focus:outline-none"
            />
            {activeFilters > 0 && (
              <button onClick={clearAll} className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] flex items-center gap-1">
                <X size={10} /> Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterChip active={harmonic} onClick={() => setHarmonic((v) => !v)} label="Harmonic key" />
            <FilterChip active={tempoClose} onClick={() => setTempoClose((v) => !v)} label="Tempo-compatible" />
            {types.length > 1 && (
              <Segment value={type} onChange={setType} options={[['all', 'Any type'], ...types.map((t) => [t, t] as [string, string])]} />
            )}
            {states.length > 0 && (
              <Segment value={state} onChange={setState} options={[['all', 'Any state'], ...states.map((s) => [s, STATE_LABEL[s] ?? s] as [string, string])]} />
            )}
            {tags.length > 0 && (
              <Segment value={tag} onChange={setTag} options={[['all', 'Any tag'], ...tags.slice(0, 40).map((t) => [t, t] as [string, string])]} />
            )}
          </div>
        </div>
      )}

      {results === null || (loading && results === null) ? (
        <div className="px-4 py-8 rounded-lg border border-[#1a160f] flex items-center justify-center gap-2 text-[11px] text-[#5a5142]">
          <Loader2 size={12} className="animate-spin" /> Finding matches in your library…
        </div>
      ) : results.length === 0 ? (
        <div className="px-4 py-8 rounded-lg border border-[#1a160f] text-center text-[11px] text-[#5a5142]">
          No comparable tracks yet — upload a few more and refresh.
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-6 rounded-lg border border-[#1a160f] text-center text-[11px] text-[#5a5142]">
          No matches fit these filters. <button onClick={clearAll} className="text-[#a08a6a] hover:text-[#E8DCC8] underline underline-offset-2">Clear filters</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map((r) => {
            const pct = matchPct(r.distance);
            const harmonicHit = r.breakdown.key <= HARMONIC_MAX;
            const tempoHit = r.breakdown.bpm <= TEMPO_MAX;
            const card = (
              <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1f1a13] bg-[#14110d] hover:border-[#2d2620] hover:bg-[#1a160f] transition-colors cursor-pointer h-full">
                <div className="relative w-10 h-10 rounded-md overflow-hidden bg-[#0a0907] border border-[#1f1a13] shrink-0">
                  {r.track.cover_url ? (
                    <img loading="lazy" src={r.track.cover_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-[#E8DCC8] truncate">{r.track.title}</p>
                  <p className="text-[9px] font-mono text-[#6a5d4a] uppercase tracking-wider mt-0.5 truncate">
                    {r.track.type}
                    {r.track.bpm ? ` · ${r.track.bpm} bpm` : ''}
                    {r.track.key ? ` · ${r.track.key}${r.track.scale ? ' ' + r.track.scale : ''}` : ''}
                  </p>
                  {(harmonicHit || tempoHit) && (
                    <div className="flex items-center gap-1 mt-1">
                      {harmonicHit && <span className="text-[8px] font-mono uppercase tracking-wider text-[#9d95e8] bg-[#1a1833]/60 px-1 py-0.5 rounded">key</span>}
                      {tempoHit && <span className="text-[8px] font-mono uppercase tracking-wider text-[#D4BFA0] bg-[#D4BFA0]/10 px-1 py-0.5 rounded">tempo</span>}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={cn(
                    'text-[10px] font-mono font-bold px-2 py-0.5 rounded-full tabular-nums',
                    pct >= 75 ? 'bg-[#D4BFA0]/15 text-[#E8D8B8] ring-1 ring-[#8A7A5C]/40'
                      : pct >= 50 ? 'bg-white/[0.04] text-[#a08a6a] ring-1 ring-[#2d2620]'
                        : 'bg-white/[0.02] text-[#5a5142] ring-1 ring-[#1f1a13]',
                  )}>
                    {pct}%
                  </span>
                  {onPick
                    ? <Plus size={14} className="text-[#6a5d4a] group-hover:text-[#E8DCC8] transition-colors" />
                    : <ChevronRight size={14} className="text-[#3a3328] group-hover:text-[#E8DCC8] transition-colors" />}
                </div>
              </div>
            );
            return onPick ? (
              <button key={r.track.id} onClick={() => onPick(r.track.id)} className="text-left">{card}</button>
            ) : (
              <Link key={r.track.id} href={`/library/${r.track.id}`}>{card}</Link>
            );
          })}
        </div>
      )}
      </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border transition-colors',
        active
          ? 'bg-[#2A2418] text-[#E8D8B8] border-[#8A7A5C]/40'
          : 'border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a] hover:border-[#2d2620]',
      )}
    >
      {label}
    </button>
  );
}

function Segment({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border bg-transparent cursor-pointer transition-colors focus:outline-none',
        value !== 'all'
          ? 'bg-[#2A2418] text-[#E8D8B8] border-[#8A7A5C]/40'
          : 'border-[#1f1a13] text-[#6a5d4a] hover:text-[#a08a6a] hover:border-[#2d2620]',
      )}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v} className="bg-[#0a0907] text-[#E8DCC8] normal-case">{label}</option>
      ))}
    </select>
  );
}
