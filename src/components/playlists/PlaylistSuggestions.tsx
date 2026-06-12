'use client';

import { useCallback, useState } from 'react';
import { Sparkles, Loader2, Music, Plus, Check, ChevronDown } from 'lucide-react';
import { toast } from '@/hooks/useToast';

interface Track { id: string; title: string; type?: string | null; bpm?: number | null; key?: string | null; scale?: string | null; cover_url?: string | null }

interface SimilarResult {
  track: Track & { tags?: { tag: string; category?: string | null }[] };
  distance: number;
  breakdown: { bpm: number; key: number; vibe: number; type: number };
}

/**
 * "Add similar tracks" panel for the playlist detail.
 *
 * Seeds from the 3 most representative tracks in the playlist (spread across
 * the set by position) to capture the full vibe, not just the opener. For each
 * seed it fetches /api/tracks/[id]/similar, then merges + deduplicates against
 * the current playlist, re-ranks by average distance across all seeds, and
 * surfaces the top ~12 candidates as one-click additions.
 *
 * Collapsed by default — the panel takes up no vertical space until opened.
 */
export function PlaylistSuggestions({
  playlistId,
  playlistTracks,
  onAdded,
}: {
  playlistId: string;
  playlistTracks: Track[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SimilarResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (playlistTracks.length === 0) return;
    setLoading(true);
    try {
      // Pick up to 3 seeds spread across the playlist to capture its range.
      const seeds = pickSeeds(playlistTracks, 3);
      const existingIds = new Set(playlistTracks.map((t) => t.id));

      const allResults = await Promise.all(
        seeds.map((t) =>
          fetch(`/api/tracks/${t.id}/similar?limit=20`)
            .then((r) => (r.ok ? r.json() : { results: [] }))
            .then((d) => d.results as SimilarResult[])
            .catch(() => [] as SimilarResult[]),
        ),
      );

      // Merge: for each candidate, keep the BEST (lowest) distance across seeds.
      const best = new Map<string, SimilarResult>();
      for (const list of allResults) {
        for (const r of list) {
          if (existingIds.has(r.track.id)) continue;
          const prev = best.get(r.track.id);
          if (!prev || r.distance < prev.distance) best.set(r.track.id, r);
        }
      }

      // Sort by distance (most similar first) and cap at 12.
      const sorted = [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, 12);
      setResults(sorted);
    } catch (err) {
      console.error('Playlist suggestions failed:', err);
      toast.error("Couldn't load suggestions");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [playlistTracks]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && results === null && !loading) load();
  };

  const addTrack = async (trackId: string) => {
    if (adding.has(trackId) || added.has(trackId)) return;
    setAdding((prev) => new Set(prev).add(trackId));
    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: [trackId] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAdded((prev) => new Set(prev).add(trackId));
      onAdded();
    } catch (err) {
      toast.error("Couldn't add track", err instanceof Error ? err.message : 'Try again');
    } finally {
      setAdding((prev) => { const n = new Set(prev); n.delete(trackId); return n; });
    }
  };

  const matchPct = (d: number) => Math.max(0, Math.round((1 - d / 2) * 100));

  return (
    <div className="mt-8">
      {/* Toggle header */}
      <button
        onClick={toggleOpen}
        className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border text-left transition-colors ${
          open
            ? 'border-[#2B2821] bg-[#11100D] rounded-b-none'
            : 'border-[#2B2821] bg-[#171511] hover:border-[#3B372F] hover:bg-[#211F1A]'
        }`}
      >
        <Sparkles size={13} className="text-[#D0C3AF] shrink-0" />
        <span className="text-[11px] font-medium text-[#F7EBDD]">Add similar tracks</span>
        <span className="text-[10px] font-mono text-[#9B9282] hidden sm:inline">
          {results ? `${results.filter((r) => !added.has(r.track.id)).length} suggestions` : 'based on this playlist\'s vibe'}
        </span>
        <div className="flex-1" />
        {loading && <Loader2 size={12} className="animate-spin text-[#9B9282]" />}
        <span className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99]">{open ? 'Hide' : 'Show'}</span>
        <ChevronDown size={13} className={`text-[#9B9282] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border border-t-0 border-[#2B2821] rounded-b-xl bg-[#11100D] p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[#9B9282]">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-[11px] font-mono">Finding matches…</span>
            </div>
          ) : !results || results.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[11px] text-[#9B9282]">
                {playlistTracks.length === 0
                  ? 'Add some tracks first, then come back for suggestions.'
                  : 'No similar tracks found in your library — upload more and try again.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {results.map((r) => {
                const isDone = added.has(r.track.id);
                const isBusy = adding.has(r.track.id);
                const pct = matchPct(r.distance);
                return (
                  <div key={r.track.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#171511] border border-[#2B2821] hover:border-[#3B372F] transition-colors">
                    <div className="w-9 h-9 rounded-md overflow-hidden bg-[#090907] border border-[#2B2821] shrink-0">
                      {r.track.cover_url
                        ? <img loading="lazy" src={r.track.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={12} /></div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-[#F7EBDD] truncate">{r.track.title}</p>
                      <p className="text-[9px] font-mono text-[#B4AA99] uppercase tracking-wider mt-0.5 truncate">
                        {r.track.type}
                        {r.track.bpm ? ` · ${r.track.bpm} bpm` : ''}
                        {r.track.key ? ` · ${r.track.key}${r.track.scale === 'minor' ? 'm' : ''}` : ''}
                      </p>
                    </div>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full tabular-nums shrink-0 ${
                      pct >= 75 ? 'bg-[#E7D7BE]/15 text-[#F3E6D1]' : 'bg-white/[0.03] text-[#9B9282]'
                    }`}>{pct}%</span>
                    <button
                      onClick={() => addTrack(r.track.id)}
                      disabled={isBusy || isDone}
                      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        isDone
                          ? 'bg-[#6DC6A4]/15 text-[#6DC6A4] border border-[#6DC6A4]/25'
                          : 'bg-[#342F27] text-[#F3E6D1] border border-[#C9BCA8]/40 hover:bg-[#332b1d] active:scale-90 disabled:opacity-50'
                      }`}
                      aria-label={isDone ? 'Added' : 'Add to playlist'}
                    >
                      {isBusy ? <Loader2 size={12} className="animate-spin" /> : isDone ? <Check size={12} /> : <Plus size={13} />}
                    </button>
                  </div>
                );
              })}
              <button
                onClick={load}
                disabled={loading}
                className="w-full mt-2 py-2 text-[10px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF] transition-colors"
              >
                Refresh suggestions
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Pick up to `n` seed tracks spread across the playlist by index so we
 * sample the beginning, middle, and end of the curation — not just the opener.
 */
function pickSeeds(tracks: Track[], n: number): Track[] {
  if (tracks.length <= n) return [...tracks];
  const seeds: Track[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (tracks.length - 1));
    seeds.push(tracks[idx]);
  }
  return seeds;
}
