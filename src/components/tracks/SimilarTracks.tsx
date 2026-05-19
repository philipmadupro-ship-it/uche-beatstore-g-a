'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Music, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { toast } from '@/hooks/useToast';

/**
 * "Find Matches" surface — when building a project or playlist, the
 * producer wants to spin up a curated set of vibe-adjacent tracks
 * without manually browsing the library. The endpoint
 * /api/tracks/[id]/similar already does the BPM/key/vibe scoring;
 * this is the UI wedge that exposes it on the library detail page.
 *
 * Default state is a single button (cheap; no network until clicked).
 * After fetch, results render as a quiet row of cards with similarity
 * % + per-track meta. Each card links straight to its own detail
 * page so the producer can chain-browse.
 */

interface SimilarTrack {
  track: {
    id: string;
    title: string;
    type: string;
    cover_url?: string | null;
    bpm?: number | null;
    key?: string | null;
    scale?: string | null;
  };
  distance: number;
  breakdown: { bpm: number; key: number; vibe: number; type: number };
}

interface Props {
  trackId: string;
  /** Optional: when set, clicking a result calls this instead of navigating.
   *  Lets parent surfaces (playlist builder, send modal) consume the picks. */
  onPick?: (trackId: string) => void;
}

export function SimilarTracks({ trackId, onPick }: Props) {
  const [results, setResults] = useState<SimilarTrack[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSimilar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracks/${trackId}/similar?limit=8`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (err) {
      console.error('Similar tracks failed:', err);
      toast.error('Couldn’t find matches', err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  // Map raw distance ([0, ~3], smaller = more similar) to a friendly
  // "X% match" badge so the producer doesn't have to interpret the
  // scoring math. 0 → 100%, clamps at 0 for far matches.
  const matchPct = (distance: number) => Math.max(0, Math.round((1 - distance / 2) * 100));

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] flex items-center gap-2">
          <Sparkles size={11} />
          Similar tracks
        </p>
        {results !== null && (
          <button
            onClick={fetchSimilar}
            disabled={loading}
            className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors disabled:opacity-40"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {results === null ? (
        // Pre-fetch state — single CTA. Doesn't network until clicked.
        <button
          onClick={fetchSimilar}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-[#1f1a13] hover:border-[#2d2620] hover:bg-white/[0.02] text-[11px] font-medium text-[#a08a6a] hover:text-[#E8DCC8] transition-colors"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          Find matches in your library
        </button>
      ) : results.length === 0 ? (
        <div className="px-4 py-8 rounded-lg border border-[#1a160f] text-center text-[11px] text-[#5a5142]">
          No comparable tracks yet — upload a few more and try again.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {results.map((r) => {
            const pct = matchPct(r.distance);
            const card = (
              <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1f1a13] bg-[#14110d] hover:border-[#2d2620] hover:bg-[#1a160f] transition-colors cursor-pointer">
                {/* Cover thumb */}
                <div className="relative w-10 h-10 rounded-md overflow-hidden bg-[#0a0907] border border-[#1f1a13] shrink-0">
                  {r.track.cover_url ? (
                    <img loading="lazy" src={r.track.cover_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                      <Music size={14} />
                    </div>
                  )}
                </div>

                {/* Meta */}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-[#E8DCC8] truncate">{r.track.title}</p>
                  <p className="text-[9px] font-mono text-[#6a5d4a] uppercase tracking-wider mt-0.5">
                    {r.track.type}
                    {r.track.bpm ? ` · ${r.track.bpm} bpm` : ''}
                    {r.track.key ? ` · ${r.track.key}${r.track.scale ? ' ' + r.track.scale : ''}` : ''}
                  </p>
                </div>

                {/* Match badge — tinted by quality. >75% gold, >50% cream,
                    anything dimmer is faint. */}
                <div className="shrink-0 flex items-center gap-2">
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full tabular-nums ${
                      pct >= 75
                        ? 'bg-[#D4BFA0]/15 text-[#E8D8B8] ring-1 ring-[#8A7A5C]/40'
                        : pct >= 50
                          ? 'bg-white/[0.04] text-[#a08a6a] ring-1 ring-[#2d2620]'
                          : 'bg-white/[0.02] text-[#5a5142] ring-1 ring-[#1f1a13]'
                    }`}
                  >
                    {pct}%
                  </span>
                  {onPick ? (
                    <Plus size={14} className="text-[#6a5d4a] group-hover:text-[#E8DCC8] transition-colors" />
                  ) : (
                    <ChevronRight size={14} className="text-[#3a3328] group-hover:text-[#E8DCC8] transition-colors" />
                  )}
                </div>
              </div>
            );

            // When the parent wants to consume picks (playlist / send
            // builder) we fire the callback; otherwise the card is a
            // straight link to the track detail page.
            return onPick ? (
              <button key={r.track.id} onClick={() => onPick(r.track.id)} className="text-left">
                {card}
              </button>
            ) : (
              <Link key={r.track.id} href={`/library/${r.track.id}`}>
                {card}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
